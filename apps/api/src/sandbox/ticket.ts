import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";

export const TICKET_TTL_MS = 30_000;
export const TICKET_MAX_PENDING = 2000;
const WINDOW_MS = 60_000;
const MAX_MINTS = 20;
export const TICKET_MAX_PER_LEARNER = 4;

export class TicketCapacityError extends Error {
  constructor() {
    super("Too many pending shell tickets");
  }
}

// Per-process, like the `open` map in route.ts: a multi-instance deploy would need a shared store.
const pending = new Map<string, { learnerId: string; exp: number }>();
const windows = new Map<string, { start: number; n: number }>();
const MAX_WINDOWS = 1000;

export function _resetForTests() {
  pending.clear();
  windows.clear();
}

/** URL for logs: the shell path loses its whole query, any other URL only its `ticket` values (even percent-encoded keys). */
export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const i = url.indexOf("?");
  if (i < 0) return url;
  const path = url.slice(0, i);
  if (path.endsWith("/sandbox/shell")) return path;
  const query = url
    .slice(i + 1)
    .split("&")
    .map((kv) => {
      const [k = ""] = kv.split("=", 1);
      let key = k;
      try {
        key = decodeURIComponent(k.replace(/\+/g, " "));
      } catch {
        // Undecodable keys are left as they are.
      }
      return key === "ticket" ? `${k}=[redacted]` : kv;
    })
    .join("&");
  return `${path}?${query}`;
}

/** Single-use, short-lived credential for the shell WebSocket, which cannot carry the session cookie cross-host. */
export function mintTicket(learnerId: string, now = Date.now()): string {
  // A learner keeps at most TICKET_MAX_PER_LEARNER live tickets: the oldest are revoked (Map order is insertion order).
  const mine = [...pending].filter(([, v]) => v.learnerId === learnerId).map(([t]) => t);
  for (const t of mine.slice(0, Math.max(0, mine.length - (TICKET_MAX_PER_LEARNER - 1)))) pending.delete(t);
  if (pending.size >= TICKET_MAX_PENDING) {
    for (const [t, v] of pending) if (v.exp <= now) pending.delete(t);
    if (pending.size >= TICKET_MAX_PENDING) throw new TicketCapacityError();
  }
  const ticket = randomBytes(32).toString("base64url");
  pending.set(ticket, { learnerId, exp: now + TICKET_TTL_MS });
  return ticket;
}

/** Returns the learner id and consumes the ticket; the entry is removed even when it has expired. */
export function redeemTicket(ticket: string, now = Date.now()): string | null {
  const v = pending.get(ticket);
  if (!v) return null;
  pending.delete(ticket);
  return v.exp > now ? v.learnerId : null;
}

export async function sandboxTicketRoute(app: FastifyInstance) {
  const allowed = (learner: string) => {
    const now = Date.now();
    if (windows.size >= MAX_WINDOWS) for (const [l, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(l);
    const w = windows.get(learner);
    if (!w || now - w.start >= WINDOW_MS) {
      windows.set(learner, { start: now, n: 1 });
      return true;
    }
    w.n += 1;
    return w.n <= MAX_MINTS;
  };
  const err = (code: string, message: string) => ({ error: { code, message } });

  app.post("/sandbox/shell-ticket", async (req, reply) => {
    if (!env.SANDBOX_ENABLED) return reply.status(503).send(err("unavailable", "Sandbox is disabled"));
    const learner = await resolveLearnerId(req.headers);
    if (!learner) return reply.status(401).send(err("unauthorized", "Sign in required"));
    if (!allowed(learner)) return reply.status(429).send(err("rate_limited", "Slow down"));
    try {
      return { ticket: mintTicket(learner), expiresInMs: TICKET_TTL_MS };
    } catch (e) {
      if (e instanceof TicketCapacityError) return reply.status(503).send(err("unavailable", "Try again shortly"));
      throw e;
    }
  });
}
