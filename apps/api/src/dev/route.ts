import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ENGINE_CALLS_PER_REPLY, assertAiEnabled, reserveAiSpend } from "../config/budget.ts";
import { isSafeText } from "../safety/moderation.ts";
import { env } from "../env.ts";
import { loadGuideContext } from "../ai/guide-context.ts";
import { containsAnswer } from "../ai/answer-leak.ts";
import { callEngine, EngineError } from "../engine-client/client.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { parseDir } from "../sandbox/files.ts";
import { PRACTICE_LANGUAGES, type PracticeLanguage } from "../parts/practice-schema.ts";
import { lintCode, sourceLineOf } from "../lint/index.ts";
import { getBackend, SandboxFileTooLargeError, SandboxNotRunningError, type SandboxBackend } from "../sandbox/backend.ts";

const Body = z.object({ prompt: z.string().min(1).max(500) });
const GuideBody = z.object({
  lessonId: z.string().regex(/^[\w-]{1,64}$/).optional(),
  fileName: z.string().min(1).max(240),
  projectRoot: z.string().min(1).max(64),
  language: z.string().min(1).max(40),
  code: z.string().max(12_000),
  finding: z.object({ ruleId: z.string().min(1).max(120), line: z.number().int().min(1).max(100_000), column: z.number().int().min(1).max(100_000).optional() }).optional(),
  selection: z.string().max(3_000).default(""),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2_000) })).min(1).max(8),
}).refine((body) => body.messages.at(-1)?.role === "user");
const GuideWidget = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hint"), title: z.string().max(80), body: z.string().max(350) }),
  z.object({ type: z.literal("steps"), title: z.string().max(80), items: z.array(z.string().max(350)).min(1).max(4) }),
  z.object({ type: z.literal("question"), text: z.string().max(250) }),
]);
const GuideResponse = z.object({ guide: z.object({ message: z.string().min(1).max(1200), widgets: z.array(GuideWidget).max(3) }) });
const guideCalls = new Map<string, { started: number; count: number }>();
const GUIDE_MAX_FILES = 24;
const GUIDE_MAX_DEPTH = 4;
const GUIDE_FILE_CHARS = 6_000;
const GUIDE_CONTEXT_CHARS = 18_000;
const GUIDE_IGNORED_DIRS = new Set([".git", "node_modules", ".venv", "dist", "build", "coverage", ".next", "vendor"]);
const GUIDE_TEXT_FILE = /\.(?:[cm]?[jt]sx?|py|json|md|txt|html?|css|scss|ya?ml|toml|sh|sql|xml|ini|cfg)$/i;

export async function readGuideWorkspaceFiles(
  backend: Pick<SandboxBackend, "listDir" | "readWorkspaceFile">,
  learnerId: string,
  projectRoot: string,
): Promise<{ path: string; content: string }[]> {
  const root = parseDir(projectRoot);
  if (root !== projectRoot || root.split("/").length !== 1 || !backend.listDir || !backend.readWorkspaceFile) return [];

  const directories: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  const paths: string[] = [];
  for (let index = 0; index < directories.length && index < 32 && paths.length < GUIDE_MAX_FILES; index++) {
    const current = directories[index];
    const listing = await backend.listDir(learnerId, current.path);
    for (const entry of listing?.entries ?? []) {
      const path = `${current.path}/${entry.name}`;
      if (entry.type === "dir" && current.depth < GUIDE_MAX_DEPTH && !GUIDE_IGNORED_DIRS.has(entry.name)) {
        directories.push({ path, depth: current.depth + 1 });
      } else if (entry.type === "file" && GUIDE_TEXT_FILE.test(entry.name) && !/^\.env(?:\.|$)/i.test(entry.name) && !/lock\.(?:json|yaml)$/i.test(entry.name)) {
        paths.push(path);
        if (paths.length >= GUIDE_MAX_FILES) break;
      }
    }
  }

  const files: { path: string; content: string }[] = [];
  let remaining = GUIDE_CONTEXT_CHARS;
  for (const path of paths) {
    if (remaining <= 0) break;
    try {
      const content = await backend.readWorkspaceFile(learnerId, path);
      if (!content) continue;
      const clipped = content.slice(0, Math.min(GUIDE_FILE_CHARS, remaining));
      files.push({ path, content: clipped });
      remaining -= clipped.length;
    } catch (error) {
      if (error instanceof SandboxNotRunningError) throw error;
      if (!(error instanceof SandboxFileTooLargeError)) throw error;
    }
  }
  return files;
}

export const GUIDE_ENGINE_BODY_LIMIT_BYTES = 64 * 1024;

export function guideBodyTooLarge(engineBody: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(engineBody), "utf8") > GUIDE_ENGINE_BODY_LIMIT_BYTES;
}

export async function devRoutes(app: FastifyInstance) {
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") return;

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

export type GuideDeps = {
  reserveAiSpend?: typeof reserveAiSpend;
  isSafeText?: typeof isSafeText;
  resolveLearnerId?: typeof resolveLearnerId;
  callEngine?: typeof callEngine;
  lintCode?: typeof lintCode;
  getBackend?: typeof getBackend;
};

const GUIDE_SOURCE_LINE_CHARS = 200;
const GUIDE_MESSAGE_CHARS = 300;
const GUIDE_LINT_TIMEOUT_MS = 2_000;

export async function guideRoutes(app: FastifyInstance, deps: GuideDeps = {}) {
  const resolve = deps.resolveLearnerId ?? resolveLearnerId;
  const engine = deps.callEngine ?? callEngine;
  const lint = deps.lintCode ?? lintCode;
  const backendOf = deps.getBackend ?? getBackend;
  const reserve = deps.reserveAiSpend ?? reserveAiSpend;
  const moderate = deps.isSafeText ?? isSafeText;
  app.post("/guide/chat", async (req, reply) => {
    const learnerId = await resolve(req.headers);
    if (!learnerId) return reply.status(401).send({ error: { code: "unauthorized", message: "Sign in to chat with the code guide" } });
    const body = GuideBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "bad_request", message: "The chat message or code context is too large" } });

    const now = Date.now();
    for (const [id, window] of guideCalls) if (now - window.started >= 60_000) guideCalls.delete(id);
    const window = guideCalls.get(learnerId);
    if (window && now - window.started < 60_000 && window.count >= 10) {
      return reply.status(429).send({ error: { code: "rate_limited", message: "Please wait a moment before sending another message" } });
    }
    if (window && now - window.started < 60_000) window.count++;
    else guideCalls.set(learnerId, { started: now, count: 1 });

    try {
      assertAiEnabled();
      const learnerText = body.data.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
      if (!(await moderate(learnerText))) {
        return reply.status(422).send({ error: { code: "content_refused", message: "Please ask a question about learning to program." } });
      }
      let workspaceFiles: { path: string; content: string }[] = [];
      try {
        workspaceFiles = await readGuideWorkspaceFiles(await backendOf(), learnerId, body.data.projectRoot);
      } catch (error) {
        if (!(error instanceof SandboxNotRunningError)) req.log.warn({ err: error }, "editor guide could not read workspace files");
      }
      const { finding, lessonId, ...rest } = body.data;
      const lesson = lessonId ? await loadGuideContext(learnerId, lessonId) : null;
      let lintFinding: { ruleId: string; message: string; line: number; sourceLine: string } | undefined;
      const lintLanguage = (PRACTICE_LANGUAGES as readonly string[]).includes(rest.language) ? (rest.language as PracticeLanguage) : undefined;
      if (finding && lintLanguage) {
        try {
          const match = (await lint(rest.code, lintLanguage, { timeoutMs: GUIDE_LINT_TIMEOUT_MS })).find(
            (f) => f.ruleId === finding.ruleId && f.line === finding.line && (finding.column === undefined || f.column === finding.column),
          );
          if (match) {
            const sourceLine = sourceLineOf(rest.code, match.line).trim().slice(0, GUIDE_SOURCE_LINE_CHARS);
            lintFinding = { ruleId: match.ruleId, message: match.message.slice(0, GUIDE_MESSAGE_CHARS), line: match.line, sourceLine };
          }
        } catch (error) {
          req.log.warn({ err: error }, "editor guide could not lint the code");
        }
      }
      const engineBody = { ...rest, workspaceFiles, ...(lesson ? { lessonContext: lesson.context } : {}), ...(lintFinding ? { lintFinding } : {}) };
      while (workspaceFiles.length && Buffer.byteLength(JSON.stringify(engineBody), "utf8") > 60 * 1024) {
        workspaceFiles.pop();
      }
      if (guideBodyTooLarge(engineBody)) {
        return reply.status(413).send({ error: { code: "guide_too_large", message: "That is too much text for the guide. Shorten the selection or the question." } });
      }
      await reserve(env.AI_CALL_ESTIMATE_USD * ENGINE_CALLS_PER_REPLY);
      const { guide } = GuideResponse.parse(await engine("/v1/guide/chat", engineBody, { timeoutMs: 30_000 }));
      const texts = [guide.message, ...guide.widgets.flatMap((widget) => {
        if (widget.type === "question") return [widget.text];
        return [widget.title, ...(widget.type === "hint" ? [widget.body] : widget.items)];
      })];
      if (lesson?.answers.some((answer) => texts.some((text) => containsAnswer(text, answer)))) {
        return { guide: { message: "Let's work through one clue together. What do you expect your code to do next?", widgets: [] } };
      }
      await lesson?.recordHint?.();
      return { guide };
    } catch (error) {
      if (error instanceof TRPCError) {
        return reply.status(error.code === "TOO_MANY_REQUESTS" ? 429 : error.code === "NOT_FOUND" ? 404 : 503).send({ error: { code: "guide_unavailable", message: error.message } });
      }
      const engineError = error instanceof EngineError ? error : null;
      req.log.warn({ status: engineError?.status }, "editor guide request failed");
      return reply.status(engineError?.status === 503 ? 503 : 502).send({
        error: { code: "guide_unavailable", message: "The AI guide is unavailable right now. Please try again shortly." },
      });
    }
  });
}
