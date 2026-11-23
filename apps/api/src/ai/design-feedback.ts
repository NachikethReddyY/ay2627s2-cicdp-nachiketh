import type { FastifyInstance } from "fastify";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { resolveLearnerId } from "../auth/guards.ts";
import { assertAiEnabled, ENGINE_CALLS_PER_REPLY, reserveAiSpend } from "../config/budget.ts";
import { callEngine } from "../engine-client/client.ts";
import { env } from "../env.ts";
import { practiceRevision, practiceTests } from "../parts/practice.ts";
import { matchesPracticeReceipt } from "../parts/submission-receipt.ts";
import { isSafeText } from "../safety/moderation.ts";
import { CheckCode } from "../sandbox/check.ts";
import { containsAnswer } from "./answer-leak.ts";
import { takeGuideCall } from "./guide-rate.ts";

const Body = z.strictObject({
  lessonId: z.string().regex(/^[\w-]{1,64}$/),
  code: CheckCode,
  receipt: z.string().regex(/^[a-f0-9]{64}$/),
});

const notes = {
  naming: "This name makes its role hard to infer. What could you call it so a reader knows what it represents?",
  decomposition: "This section handles more than one job. Where could you split it so each part has one responsibility?",
  repetition: "This section repeats a pattern elsewhere. What do those sections have in common that you could name once?",
  complexity: "This section is hard to follow. Could a reader understand it more easily if you simplified the decisions here?",
  efficiency: "This section repeats work as the input grows. Which work could you avoid doing again?",
};

const Finding = z.strictObject({
  focus: z.enum(["naming", "decomposition", "repetition", "complexity", "efficiency"]),
  line: z.number().int().positive(),
});
const Response = z.object({ feedback: z.strictObject({ finding: Finding.nullable() }) });

type Deps = {
  resolveLearnerId?: typeof resolveLearnerId;
  practiceTests?: typeof practiceTests;
  reserveAiSpend?: typeof reserveAiSpend;
  isSafeText?: typeof isSafeText;
  callEngine?: typeof callEngine;
};

export async function designFeedbackRoutes(app: FastifyInstance, deps: Deps = {}) {
  const resolve = deps.resolveLearnerId ?? resolveLearnerId;
  const loadPractice = deps.practiceTests ?? practiceTests;
  const reserve = deps.reserveAiSpend ?? reserveAiSpend;
  const moderate = deps.isSafeText ?? isSafeText;
  const engine = deps.callEngine ?? callEngine;
  const errorBody = (message: string) => ({ error: { code: "feedback_unavailable", message } });

  app.post("/practice/design-feedback", async (req, reply) => {
    const learnerId = await resolve(req.headers);
    if (!learnerId) return reply.status(401).send(errorBody("Sign in to request design feedback."));
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send(errorBody("Invalid design feedback request."));
    const { lessonId, code, receipt } = parsed.data;
    if (!takeGuideCall(learnerId)) {
      return reply.status(429).send(errorBody("Please wait a moment before requesting more feedback."));
    }
    try {
      assertAiEnabled();
      const current = await loadPractice(learnerId, lessonId);
      if (!current) return reply.status(404).send(errorBody("Practice lesson not found."));
      const { practice, versionId } = current;
      if (!matchesPracticeReceipt(receipt, learnerId, practiceRevision(versionId, practice), code)) {
        return reply.status(403).send(errorBody("Submit this code before requesting design feedback."));
      }
      const input = { code, language: practice.language };
      if (Buffer.byteLength(JSON.stringify(input), "utf8") > 64 * 1024) {
        return reply.status(413).send(errorBody("This submission is too large for design feedback."));
      }
      if (!(await moderate(code))) return reply.status(422).send(errorBody("Design feedback is unavailable for this submission."));
      await reserve(env.AI_CALL_ESTIMATE_USD * ENGINE_CALLS_PER_REPLY);
      const { feedback: { finding } } = Response.parse(await engine("/v1/guide/design-feedback", input, { timeoutMs: 30_000 }));
      if (!finding) return { feedback: null };
      if (!code.split(/\r\n?|\n/)[finding.line - 1]?.trim()) return { feedback: null };

      const note = notes[finding.focus];
      const protectedText = [practice.referenceSolution, ...practice.tests.flatMap((test) =>
        test.visibility === "hidden" ? [test.stdin, test.expectedStdout] : [test.expectedStdout],
      )];
      if (protectedText.some((answer) => answer && containsAnswer(note, answer))) return { feedback: null };
      return { feedback: { line: finding.line, note } };
    } catch (error) {
      if (error instanceof TRPCError) {
        return reply.status(error.code === "TOO_MANY_REQUESTS" ? 429 : 503).send(errorBody(error.message));
      }
      req.log.warn("design feedback request failed");
      return reply.status(502).send(errorBody("Design feedback is unavailable right now. Please try again."));
    }
  });
}
