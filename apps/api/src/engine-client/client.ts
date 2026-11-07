import { env } from "../env.ts";

/** Engine failures carry the HTTP status the API should answer with, and the engine's JSON body if any. */
export class EngineError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** POSTs JSON to a Python engine route. Throws EngineError on transport failure, timeout, or a non-2xx answer. */
export async function callEngine<T = unknown>(path: `/v1/${string}`, body: unknown): Promise<T> {
  if (!env.ENGINE_TOKEN) throw new EngineError("ENGINE_TOKEN is not set", 503, null);
  let res: Response;
  try {
    res = await fetch(new URL(path, env.ENGINE_URL), {
      method: "POST",
      headers: { "content-type": "application/json", "x-engine-token": env.ENGINE_TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.ENGINE_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new EngineError(`Engine unreachable at ${env.ENGINE_URL}`, 502, cause);
  }
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new EngineError(`Engine answered ${res.status}`, res.status, json);
  return json as T;
}
