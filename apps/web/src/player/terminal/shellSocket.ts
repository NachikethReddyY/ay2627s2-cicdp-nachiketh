// Reconnecting client for the sandbox shell WebSocket (GET /api/sandbox/shell).
// Pure TypeScript: only the WebSocket type and TextEncoder are used, so it runs under `node --test`.

export type CloseReason = "disabled" | "signed_out" | "too_many_tabs" | "busy" | "replaced";

export type ShellState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "open"; ready: boolean }
  | { kind: "reconnecting"; attempt: number; inMs: number }
  | { kind: "paused" }
  | { kind: "exited"; code: number }
  | { kind: "closed"; reason: CloseReason; message: string };

export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000];

export function backoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1)];
}

export function shellUrl(
  loc: { protocol: string; host: string },
  cols: number,
  rows: number,
  opts?: { wsOrigin?: string; ticket?: string },
): string {
  if (opts?.wsOrigin && opts.ticket) {
    return `${opts.wsOrigin}/api/sandbox/shell?tab=practice&cols=${cols}&rows=${rows}&ticket=${encodeURIComponent(opts.ticket)}`;
  }
  const scheme = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${loc.host}/api/sandbox/shell?tab=practice&cols=${cols}&rows=${rows}`;
}

/** Trim, drop trailing slashes and map http(s):// to ws(s)://. Empty or missing means same-origin. */
export function normalizeWsOrigin(raw: string | undefined): string | undefined {
  let v = (raw ?? "").trim().replace(/\/+$/, "");
  if (/^https:\/\//i.test(v)) v = "wss://" + v.slice(8);
  else if (/^http:\/\//i.test(v)) v = "ws://" + v.slice(7);
  return v || undefined;
}

/** Absolute ws(s) origin of the API host (VITE_SHELL_WS_ORIGIN); undefined means same-origin (dev proxy). */
export function defaultWsOrigin(): string | undefined {
  const v = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SHELL_WS_ORIGIN;
  return normalizeWsOrigin(v);
}

/** POST /api/sandbox/shell-ticket. Throws an error carrying `status` (and the server's `error.code` when the body has one) on a non-2xx answer. Never logs the ticket. */
async function defaultFetchTicket(): Promise<string> {
  const res = await fetch("/api/sandbox/shell-ticket", { method: "POST", credentials: "include" });
  if (!res.ok) {
    let code: string | undefined;
    try {
      const b = (await res.json()) as { error?: { code?: unknown } } | null;
      if (typeof b?.error?.code === "string") code = b.error.code;
    } catch {
      // Unparsable body: no code, treated as a transient failure.
    }
    throw Object.assign(new Error(`Shell ticket failed (${res.status})`), { status: res.status, code });
  }
  const body: unknown = await res.json();
  const ticket = (body as { ticket?: unknown } | null)?.ticket;
  if (typeof ticket !== "string" || !ticket) throw new Error("Shell ticket response had no ticket");
  return ticket;
}

export class ShellNotReadyError extends Error {
  readonly why: "timeout" | CloseReason | "exited";
  constructor(why: "timeout" | CloseReason | "exited") {
    super(`Shell not ready: ${why}`);
    this.name = "ShellNotReadyError";
    this.why = why;
  }
}

export interface ShellSocket {
  /** No-op unless idle, closed or exited. Without a size it reuses the last one (set by connect or resize). */
  connect(cols?: number, rows?: number): void;
  /** Binary frame; dropped unless open. "\r" while exited reconnects. */
  send(data: string): void;
  /** {type:"resize"} text frame when open. */
  resize(cols: number, rows: number): void;
  /** Resolves when the current connection is open and has produced output. */
  whenReady(timeoutMs: number): Promise<void>;
  /** false: a drop goes to "paused" with no retries; true resumes. */
  setActive(active: boolean): void;
  onOutput(cb: (bytes: Uint8Array) => void): () => void;
  onState(cb: (s: ShellState) => void): () => void;
  state(): ShellState;
  dispose(): void;
}

// Server close codes (apps/api/src/sandbox/route.ts).
const CLOSE_REASONS: Record<number, { reason: CloseReason; message: string }> = {
  4029: { reason: "too_many_tabs", message: "Too many terminals are open" },
  4503: { reason: "busy", message: "The sandbox is busy, try again soon" },
  4000: { reason: "replaced", message: "This terminal was opened in another window" },
};

interface Deps {
  WebSocket: new (url: string) => WebSocket;
  location: { protocol: string; host: string };
  probe: () => Promise<number>;
  /** Origin to connect to directly with a ticket; unset or empty keeps the same-origin behaviour. */
  wsOrigin?: string;
  fetchTicket: () => Promise<string>;
}

interface Pending {
  resolve: () => void;
  reject: (e: ShellNotReadyError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createShellSocket(deps: Partial<Deps> = {}): ShellSocket {
  const WS = deps.WebSocket ?? globalThis.WebSocket;
  const probe =
    deps.probe ?? (() => fetch("/api/sandbox/files", { credentials: "include" }).then((r) => r.status));
  const fetchTicket = deps.fetchTicket ?? defaultFetchTicket;
  const wsOrigin = "wsOrigin" in deps ? normalizeWsOrigin(deps.wsOrigin) : defaultWsOrigin();
  const encoder = new TextEncoder();

  let state: ShellState = { kind: "idle" };
  let ws: WebSocket | null = null;
  let size = { cols: 80, rows: 24 };
  let active = true;
  let disposed = false;
  let opened = false; // the current connection reached onopen
  let ready = false; // the current connection produced output
  let attempt = 0;
  let lastError = "";
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0; // invalidates late events and probe results of earlier connections
  let pending: Pending[] = [];
  const outputCbs = new Set<(b: Uint8Array) => void>();
  const stateCbs = new Set<(s: ShellState) => void>();

  const setState = (s: ShellState) => {
    state = s;
    for (const cb of [...stateCbs]) cb(s);
  };

  const settle = (why: "exited" | CloseReason) => {
    const list = pending;
    pending = [];
    for (const p of list) {
      clearTimeout(p.timer);
      p.reject(new ShellNotReadyError(why));
    }
  };

  const markReady = () => {
    const list = pending;
    pending = [];
    for (const p of list) {
      clearTimeout(p.timer);
      p.resolve();
    }
  };

  const clearRetry = () => {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const closed = (reason: CloseReason, message: string) => {
    setState({ kind: "closed", reason, message });
    settle(reason);
  };

  const scheduleRetry = () => {
    if (!active) return setState({ kind: "paused" });
    const inMs = backoffMs(attempt);
    attempt++;
    setState({ kind: "reconnecting", attempt, inMs });
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      open();
    }, inMs);
  };

  const onDrop = (gen: number, code: number) => {
    if (gen !== generation || disposed) return;
    ws = null;
    if (state.kind === "exited" || state.kind === "closed") return;
    const fixed = CLOSE_REASONS[code];
    if (fixed) return closed(fixed.reason, lastError || fixed.message);
    if (opened) return scheduleRetry();
    // Closed before the upgrade finished: ask a plain HTTP endpoint why.
    setState({ kind: "connecting" });
    probe().then(
      (status) => {
        if (gen !== generation || disposed) return;
        if (status === 503) return closed("disabled", "The sandbox is disabled");
        if (status === 401) return closed("signed_out", "Sign in to use the terminal");
        scheduleRetry();
      },
      () => {
        if (gen !== generation || disposed) return;
        scheduleRetry();
      },
    );
  };

  const open = () => {
    const gen = ++generation;
    opened = false;
    ready = false;
    lastError = "";
    setState({ kind: "connecting" });
    if (!wsOrigin) return connectSocket(gen);
    // Tickets are single-use and short-lived, so every attempt fetches its own.
    fetchTicket().then(
      (ticket) => {
        if (gen !== generation || disposed) return;
        try {
          connectSocket(gen, ticket);
        } catch {
          // e.g. a malformed origin makes the WebSocket constructor throw.
          ws = null;
          scheduleRetry();
        }
      },
      (err: unknown) => {
        if (gen !== generation || disposed) return;
        const { status, code } = (err ?? {}) as { status?: unknown; code?: unknown };
        // Only the explicit "sandbox disabled" answer is final; a full ticket store is "busy" and retries.
        if (status === 503 && code === "unavailable") return closed("disabled", "The sandbox is disabled");
        if (status === 401) return closed("signed_out", "Sign in to use the terminal");
        scheduleRetry();
      },
    );
  };

  const connectSocket = (gen: number, ticket?: string) => {
    const socket = new WS(
      shellUrl(deps.location ?? globalThis.location, size.cols, size.rows, ticket ? { wsOrigin, ticket } : undefined),
    );
    ws = socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (gen !== generation) return;
      opened = true;
      setState({ kind: "open", ready: false });
    };
    socket.onmessage = (ev) => {
      if (gen !== generation) return;
      const data: unknown = ev.data;
      if (typeof data === "string") {
        try {
          const m = JSON.parse(data);
          if (m?.type === "error" && typeof m.message === "string") lastError = m.message;
          else if (m?.type === "exit") {
            setState({ kind: "exited", code: typeof m.code === "number" ? m.code : 0 });
            settle("exited");
          }
        } catch {
          // Ignore malformed control frames.
        }
        return;
      }
      if (!(data instanceof ArrayBuffer)) return;
      if (!ready) {
        ready = true;
        attempt = 0; // a connection that worked restarts the backoff
        setState({ kind: "open", ready: true });
        markReady();
      }
      const bytes = new Uint8Array(data);
      for (const cb of [...outputCbs]) cb(bytes);
    };
    socket.onclose = (ev) => onDrop(gen, ev.code);
  };

  return {
    connect(cols, rows) {
      if (disposed) return;
      if (state.kind !== "idle" && state.kind !== "closed" && state.kind !== "exited") return;
      if (cols !== undefined && rows !== undefined) size = { cols, rows };
      attempt = 0;
      open();
    },
    send(data) {
      if (state.kind === "exited") {
        if (data === "\r" && !disposed) {
          attempt = 0;
          open();
        }
        return;
      }
      if (state.kind === "open" && ws) ws.send(encoder.encode(data));
    },
    resize(cols, rows) {
      size = { cols, rows };
      if (state.kind === "open" && ws) ws.send(JSON.stringify({ type: "resize", cols, rows }));
    },
    whenReady(timeoutMs) {
      if (state.kind === "open" && state.ready) return Promise.resolve();
      if (state.kind === "closed") return Promise.reject(new ShellNotReadyError(state.reason));
      if (state.kind === "exited") return Promise.reject(new ShellNotReadyError("exited"));
      return new Promise<void>((resolve, reject) => {
        const entry: Pending = {
          resolve,
          reject,
          timer: setTimeout(() => {
            pending = pending.filter((p) => p !== entry);
            reject(new ShellNotReadyError("timeout"));
          }, timeoutMs),
        };
        pending.push(entry);
      });
    },
    setActive(next) {
      if (active === next || disposed) return;
      active = next;
      if (!next) {
        if (state.kind === "reconnecting") {
          clearRetry();
          setState({ kind: "paused" });
        }
      } else if (state.kind === "paused") {
        attempt = 0;
        open();
      }
    },
    onOutput(cb) {
      outputCbs.add(cb);
      return () => outputCbs.delete(cb);
    },
    onState(cb) {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
    state: () => state,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      clearRetry();
      ws?.close(1000);
      ws = null;
      const list = pending;
      pending = [];
      for (const p of list) {
        clearTimeout(p.timer);
        p.reject(new ShellNotReadyError("exited"));
      }
      outputCbs.clear();
      stateCbs.clear();
    },
  };
}
