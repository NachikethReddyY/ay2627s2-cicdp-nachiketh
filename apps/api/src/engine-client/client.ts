import { env } from "../env.ts";
import { recordEngineCallSpend } from "../admin/ai-spend.ts";

export class EngineError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfterSeconds?: number;
  constructor(message: string, status: number, body: unknown, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const ENGINE_WARMUP_TIMEOUT_MS = 120_000;
const ENGINE_WARMUP_FRESH_MS = 60_000;
let warmup: { origin: string; readyAt: number | null; request: Promise<void> } | undefined;

async function wakeHostedEngine() {
  const url = new URL("/healthz", env.ENGINE_URL);
  if (!url.hostname.endsWith(".onrender.com")) return;
  if (warmup?.origin === url.origin && (warmup.readyAt === null || Date.now() - warmup.readyAt < ENGINE_WARMUP_FRESH_MS)) {
    return warmup.request;
  }
  const current = {
    origin: url.origin,
    readyAt: null as number | null,
    request: fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ENGINE_WARMUP_TIMEOUT_MS),
    }).then(async (response) => {
      if (!response.ok) throw new EngineError("Engine warmup failed", response.status, null);
      const body: unknown = await response.json().catch(() => null);
      if (!body || typeof body !== "object" || !("ok" in body) || body.ok !== true) {
        throw new EngineError("Invalid engine health response", 502, null);
      }
      current.readyAt = Date.now();
    }).catch((cause: unknown) => {
      if (warmup === current) warmup = undefined;
      if (cause instanceof EngineError) throw cause;
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw new EngineError("Could not wake engine", timedOut ? 504 : 502, null);
    }),
  };
  warmup = current;
  return current.request;
}

export async function callEngine<T = unknown>(path: `/v1/${string}`, body: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
  if (!env.ENGINE_TOKEN) throw new EngineError("ENGINE_TOKEN is not set", 503, null);
  if (path.startsWith("/v1/pipeline/")) await wakeHostedEngine();
  let res: Response;
  try {
    res = await fetch(new URL(path, env.ENGINE_URL), {
      method: "POST",
      headers: { "content-type": "application/json", "x-engine-token": env.ENGINE_TOKEN, "x-engine-timeout-ms": String(opts.timeoutMs ?? env.ENGINE_TIMEOUT_MS) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? env.ENGINE_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new EngineError(timedOut ? "Engine timed out" : `Engine unreachable at ${env.ENGINE_URL}`, timedOut ? 504 : 502, cause);
  }
  const json = (await res.json().catch(() => null)) as unknown;
  await recordEngineCallSpend(res.headers.get("x-engine-usage"));
  if (!res.ok) {
    const retryAfter = res.headers.get("retry-after");
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
    throw new EngineError(`Engine answered ${res.status}`, res.status, json, seconds);
  }
  return json as T;
}
