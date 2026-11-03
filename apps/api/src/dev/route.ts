import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.ts";
import { callEngine, EngineError } from "../engine-client/client.ts";

const Body = z.object({ prompt: z.string().min(1).max(500) });

// Dev playground only: in production the route is never registered, so it answers the normal 404.
export async function devRoutes(app: FastifyInstance) {
  if (env.NODE_ENV === "production") return;

  app.post("/dev/visual", async (req, reply) => {
    const body = Body.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: { code: "bad_request", message: "prompt must be 1-500 characters" } });
    }
    try {
      return await callEngine("/v1/pipeline/visual", body.data);
    } catch (e) {
      const err = e instanceof EngineError ? e : null;
      const json = err?.body as { error?: unknown; issues?: unknown } | null | undefined;
      const issues = Array.isArray(json?.issues) ? ` (${json.issues.slice(0, 5).join("; ")})` : "";
      const message = err?.message === "ENGINE_TOKEN is not set"
        ? "ENGINE_TOKEN is not set in apps/api/.env"
        : `${typeof json?.error === "string" ? json.error : (err?.message ?? "Engine failed")}${issues}`;
      return reply.status(502).send({ error: { code: "engine_error", message } });
    }
  });
}
