import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.ts";

const Body = z.object({ prompt: z.string().min(1).max(500) });

// Dev playground only: in production the route is never registered, so it answers the normal 404.
export async function devRoutes(app: FastifyInstance) {
  if (env.NODE_ENV === "production") return;

  app.post("/dev/visual", async (req, reply) => {
    const body = Body.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: { code: "bad_request", message: "prompt must be 1-500 characters" } });
    }
    const fail = (message: string) =>
      reply.status(502).send({ error: { code: "engine_error", message } });
    if (!env.ENGINE_TOKEN) return fail("ENGINE_TOKEN is not set in apps/api/.env");

    let res: Response;
    try {
      res = await fetch(new URL("/v1/pipeline/visual", env.ENGINE_URL), {
        method: "POST",
        headers: { "content-type": "application/json", "x-engine-token": env.ENGINE_TOKEN },
        body: JSON.stringify(body.data),
      });
    } catch {
      return fail(`Engine unreachable at ${env.ENGINE_URL}`);
    }
    const json = (await res.json().catch(() => null)) as { error?: unknown; issues?: unknown } | null;
    if (!res.ok) {
      const issues = Array.isArray(json?.issues) ? ` (${json.issues.slice(0, 5).join("; ")})` : "";
      return fail(`${typeof json?.error === "string" ? json.error : `Engine answered ${res.status}`}${issues}`);
    }
    return json;
  });
}
