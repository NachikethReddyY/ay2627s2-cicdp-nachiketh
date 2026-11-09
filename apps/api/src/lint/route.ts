import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveLearnerId } from "../auth/guards.ts";
import { MAX_CHECK_CODE } from "../sandbox/check.ts";
import { lintCode, LintUnavailableError } from "./index.ts";

const MAX_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>(); // learner -> request times inside the window

/** Sliding window per learner; returns false once the learner is over the limit. */
function allow(learner: string, now = Date.now()): boolean {
  const recent = (hits.get(learner) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_MINUTE) {
    hits.set(learner, recent);
    return false;
  }
  recent.push(now);
  hits.set(learner, recent);
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  return true;
}

export async function lintRoute(app: FastifyInstance) {
  const Body = z.object({
    code: z.string().max(MAX_CHECK_CODE),
    language: z.enum(["javascript", "typescript", "python"]),
  });
  const fail = (code: string, message: string) => ({ error: { code, message } });

  app.post("/practice/lint", async (req, reply) => {
    const learner = await resolveLearnerId(req.headers);
    if (!learner) return reply.status(401).send(fail("unauthorized", "Sign in required"));
    const body = Body.safeParse(req.body);
    if (!body.success) return reply.status(400).send(fail("bad_request", "Invalid lint request"));
    if (!allow(learner)) return reply.status(429).send(fail("rate_limited", "Too many lint requests, wait a moment"));
    try {
      return { findings: await lintCode(body.data.code, body.data.language) };
    } catch (e) {
      if (!(e instanceof LintUnavailableError)) req.log.error(e);
      return reply.status(503).send(fail("lint_unavailable", "Could not check the code"));
    }
  });
}
