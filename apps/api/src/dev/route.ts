import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callEngine, EngineError } from "../engine-client/client.ts";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { parseDir } from "../sandbox/files.ts";
import { getBackend, SandboxFileTooLargeError, SandboxNotRunningError, type SandboxBackend, type DirEntry } from "../sandbox/backend.ts";

const Body = z.object({ prompt: z.string().min(1).max(500) });
const GuideBody = z.object({
  fileName: z.string().min(1).max(240),
  projectRoot: z.string().min(1).max(64),
  language: z.string().min(1).max(40),
  code: z.string().max(12_000),
  selection: z.string().max(3_000).default(""),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2_000) })).min(1).max(8),
});
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
    const current = directories[index]!;
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

// Must match MAX_BODY_BYTES in services/engine/learnquest_engine/server.py.
export const GUIDE_ENGINE_BODY_LIMIT_BYTES = 64 * 1024;

/** True when the JSON the engine would receive is over its body limit. Counts UTF-8 bytes, so CJK text costs 3 bytes per character. */
export function guideBodyTooLarge(engineBody: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(engineBody), "utf8") > GUIDE_ENGINE_BODY_LIMIT_BYTES;
}

// Dev playground only: /dev/visual registers in development and test. Any other env (including unset NODE_ENV, as in app.ts) answers the normal 404.
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

// Sloppy guide. The status always answers and never calls the engine. The chat registers in development and test, or when SLOPPY_ENABLED is set; otherwise it is a normal 404.
export async function guideRoutes(app: FastifyInstance) {
  app.get("/guide/status", async () => ({ enabled: env.SLOPPY_ENABLED }));

  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test" && !env.SLOPPY_ENABLED) return;

  app.post("/guide/chat", async (req, reply) => {
    const learnerId = await resolveLearnerId(req.headers);
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
      let workspaceFiles: { path: string; content: string }[] = [];
      try {
        workspaceFiles = await readGuideWorkspaceFiles(await getBackend(), learnerId, body.data.projectRoot);
      } catch (error) {
        if (!(error instanceof SandboxNotRunningError)) req.log.warn({ err: error }, "editor guide could not read workspace files");
      }
      const engineBody = { ...body.data, workspaceFiles };
      while (workspaceFiles.length && Buffer.byteLength(JSON.stringify(engineBody), "utf8") > 60 * 1024) {
        workspaceFiles.pop();
      }
      if (guideBodyTooLarge(engineBody)) {
        return reply.status(413).send({ error: { code: "guide_too_large", message: "That is too much text for the guide. Shorten the selection or the question." } });
      }
      return await callEngine<{ guide: { message: string; widgets: unknown[] } }>("/v1/guide/chat", engineBody);
    } catch (error) {
      const engineError = error instanceof EngineError ? error : null;
      req.log.warn({ status: engineError?.status }, "editor guide request failed");
      return reply.status(engineError?.status === 503 ? 503 : 502).send({
        error: { code: "guide_unavailable", message: "The AI guide is unavailable right now. Please try again shortly." },
      });
    }
  });
}
