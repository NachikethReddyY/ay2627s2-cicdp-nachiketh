import { env } from "../env.ts";

// Thin client for the Python engine, which owns the LLM call, the prompts and the schemas.
// service.ts validates what comes back with zod. Tests replace the two methods on `generator`.
export type LessonContext = {
  path: { title: string; tagline: string };
  course: { title: string; description: string };
  lesson: { title: string; level: number; concepts: string[] };
  missedConcepts: string[];
};

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${env.ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Engine-Token": env.ENGINE_TOKEN! },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150_000), // above the engine's 120 s
  });
  if (!res.ok) throw new Error(`engine ${path} failed with HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  console.info(`engine ${path} usage`, json.usage);
  return json;
}

export const generator = {
  outline: (topic: string) => post("/v1/pipeline/outline", { topic }).then((r) => r.outline),
  lesson: (ctx: LessonContext) => post("/v1/pipeline/lesson", ctx).then((r) => r.lesson),
};
