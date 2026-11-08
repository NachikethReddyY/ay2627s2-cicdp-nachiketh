import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { MAX_CODE } from "./run.ts";
import { getBackend, LIST_MAX_ENTRIES, SANDBOX_FILES, SandboxFileTooLargeError, SandboxNotRunningError, type SandboxFileName } from "./backend.ts";

const WINDOW_MS = 60_000;
const MAX_WRITES = 30;
const MAX_LISTS = 60;
const MAX_NAME = 64;
const MAX_WORKSPACE_FILE = 64 * 1024;
const MAX_BATCH_READ = 64;
const MAX_WINDOWS = 1000;
const MAX_DEPTH = 8;
const SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;

/** "" for an absent or empty dir, null for an invalid one: up to 8 safe segments, no "." or ".." and no empty ones. */
export function parseDir(raw: unknown): string | null {
  if (raw === undefined || raw === "") return "";
  if (typeof raw !== "string") return null;
  const parts = raw.split("/");
  if (parts.length > MAX_DEPTH) return null;
  return parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..") ? raw : null;
}

const fail = (code: string, message: string) => ({ error: { code, message } });

/** Fixed window per learner: true while the learner is within `max` calls in the current minute. Expired windows are pruned once the map is large. */
export function limiter(max: number, clock: () => number = Date.now) {
  const windows = new Map<string, { start: number; n: number }>();
  const check = (learner: string): boolean => {
    const now = clock();
    if (windows.size >= MAX_WINDOWS) for (const [l, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(l);
    const w = windows.get(learner);
    if (!w || now - w.start >= WINDOW_MS) {
      windows.set(learner, { start: now, n: 1 });
      return true;
    }
    w.n += 1;
    return w.n <= max;
  };
  return Object.assign(check, { size: () => windows.size });
}

// One backend call at a time per learner. The entry is dropped once the chain is idle.
const chains = new Map<string, Promise<unknown>>();
function serial<T>(learner: string, fn: () => Promise<T>): Promise<T> {
  const run = (chains.get(learner) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(learner, tail);
  void tail.then(() => {
    if (chains.get(learner) === tail) chains.delete(learner);
  });
  return run;
}

export async function sandboxFilesRoute(app: FastifyInstance) {
  const Body = z.object({ content: z.string().max(MAX_CODE) });
  const WorkspaceBody = z.object({ path: z.string(), content: z.string().max(MAX_WORKSPACE_FILE) });
  const WorkspaceMoveBody = z.object({ source: z.string(), targetDir: z.string() });
  const WorkspaceReadBatchBody = z.object({ paths: z.array(z.string()).min(1).max(MAX_BATCH_READ) });
  const writeAllowed = limiter(MAX_WRITES);
  const listAllowed = limiter(MAX_LISTS);

  const learnerFor = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!env.SANDBOX_ENABLED) { reply.status(503).send(fail("unavailable", "Sandbox is disabled")); return null; }
    const learner = await resolveLearnerId(req.headers);
    if (!learner) { reply.status(401).send(fail("unauthorized", "Sign in required")); return null; }
    return learner;
  };
  const tooMany = (reply: FastifyReply) => reply.status(429).send(fail("rate_limited", "Slow down"));
  const noShell = (reply: FastifyReply) => reply.status(409).send(fail("no_shell", "Open the terminal first"));
  const notImplemented = (reply: FastifyReply) => reply.status(501).send(fail("not_implemented", "Not supported by this sandbox"));

  app.put<{ Params: { name: string } }>("/sandbox/files/:name", { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    if (!writeAllowed(learner)) return tooMany(reply);
    const name = (SANDBOX_FILES as readonly string[]).includes(req.params.name) ? (req.params.name as SandboxFileName) : null;
    const body = Body.safeParse(req.body);
    if (!name || !body.success) return reply.status(400).send(fail("bad_request", "Unknown file or content too long"));
    const backend = await getBackend();
    if (!backend.writeFile) return notImplemented(reply);
    const write = backend.writeFile.bind(backend);
    try {
      await serial(learner, () => write(learner, name, body.data.content));
    } catch (err) {
      if (err instanceof SandboxNotRunningError) return noShell(reply);
      throw err;
    }
    return reply.status(204).send();
  });

  app.get<{ Querystring: { path?: unknown } }>("/sandbox/workspace-file", async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    if (!listAllowed(learner)) return tooMany(reply);
    const path = parseDir(req.query.path);
    if (path === null || !path) return reply.status(400).send(fail("bad_request", "Invalid file path"));
    const backend = await getBackend();
    if (!backend.readWorkspaceFile) return notImplemented(reply);
    try {
      const content = await serial(learner, () => backend.readWorkspaceFile!(learner, path));
      if (content === null) return reply.status(404).send(fail("not_found", "File not found"));
      if (Buffer.byteLength(content, "utf8") > MAX_WORKSPACE_FILE) return reply.status(413).send(fail("file_too_large", "This file is too large to open in the editor"));
      return { content };
    } catch (err) {
      if (err instanceof SandboxNotRunningError) return noShell(reply);
      if (err instanceof SandboxFileTooLargeError) return reply.status(413).send(fail("file_too_large", "This file is too large to open in the editor"));
      throw err;
    }
  });

  // One request reads up to MAX_BATCH_READ files. It counts once against listAllowed, so a project with many small files
  // does not use up the per-minute budget. Missing and oversized files come back in `skipped`, not as an error.
  app.post("/sandbox/workspace-files/read", { bodyLimit: 32 * 1024 }, async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    if (!listAllowed(learner)) return tooMany(reply);
    const body = WorkspaceReadBatchBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send(fail("bad_request", "Invalid file path list"));
    // Each path is checked on its own: an invalid one is skipped, and the valid ones still read.
    const safePaths = body.data.paths.filter((p) => parseDir(p));
    const invalidPaths = body.data.paths.filter((p) => !parseDir(p));
    const backend = await getBackend();
    if (!backend.readWorkspaceFile) return notImplemented(reply);
    const read = backend.readWorkspaceFile.bind(backend);
    try {
      const results = await serial(learner, async () => {
        const out: { path: string; content: string | null; reason?: "not_found" | "file_too_large" | "invalid_path" }[] = [];
        for (const path of invalidPaths) out.push({ path, content: null, reason: "invalid_path" });
        for (const path of safePaths) {
          try {
            const content = await read(learner, path);
            if (content === null) out.push({ path, content: null, reason: "not_found" });
            else if (Buffer.byteLength(content, "utf8") > MAX_WORKSPACE_FILE) out.push({ path, content: null, reason: "file_too_large" });
            else out.push({ path, content });
          } catch (err) {
            if (err instanceof SandboxFileTooLargeError) out.push({ path, content: null, reason: "file_too_large" });
            else throw err;
          }
        }
        return out;
      });
      return {
        files: results.flatMap((r) => (r.content === null ? [] : [{ path: r.path, content: r.content }])),
        skipped: results.flatMap((r) => (r.reason ? [{ path: r.path, reason: r.reason }] : [])),
      };
    } catch (err) {
      if (err instanceof SandboxNotRunningError) return noShell(reply);
      throw err;
    }
  });

  app.put("/sandbox/workspace-file", { bodyLimit: MAX_WORKSPACE_FILE * 3 + 1024 }, async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    if (!writeAllowed(learner)) return tooMany(reply);
    const body = WorkspaceBody.safeParse(req.body);
    const path = body.success ? parseDir(body.data.path) : null;
    if (!body.success || path === null || !path) return reply.status(400).send(fail("bad_request", "Invalid file path or content"));
    // Reads limit UTF-8 bytes, so save checks bytes too. A longer file would save but never reopen.
    if (Buffer.byteLength(body.data.content, "utf8") > MAX_WORKSPACE_FILE) return reply.status(413).send(fail("file_too_large", "This file is too large to save"));
    const backend = await getBackend();
    if (!backend.writeWorkspaceFile) return notImplemented(reply);
    try {
      await serial(learner, () => backend.writeWorkspaceFile!(learner, path, body.data.content));
    } catch (err) {
      if (err instanceof SandboxNotRunningError) return noShell(reply);
      if (err instanceof SandboxFileTooLargeError) return reply.status(413).send(fail("file_too_large", "This file is too large to save"));
      throw err;
    }
    return reply.status(204).send();
  });

  app.post("/sandbox/workspace-file/move", async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    if (!writeAllowed(learner)) return tooMany(reply);
    const body = WorkspaceMoveBody.safeParse(req.body);
    const source = body.success ? parseDir(body.data.source) : null;
    const targetDir = body.success ? parseDir(body.data.targetDir) : null;
    if (!body.success || !source || targetDir === null || !targetDir) return reply.status(400).send(fail("bad_request", "Invalid source file or destination folder"));
    const backend = await getBackend();
    if (!backend.moveWorkspaceFile) return notImplemented(reply);
    try {
      await serial(learner, () => backend.moveWorkspaceFile!(learner, source, targetDir));
    } catch (err) {
      if (err instanceof SandboxNotRunningError) return noShell(reply);
      throw err;
    }
    return reply.status(204).send();
  });

  app.get<{ Querystring: { dir?: unknown } }>("/sandbox/files", async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    if (!listAllowed(learner)) return tooMany(reply);
    const dir = parseDir(req.query.dir);
    if (dir === null) return reply.status(400).send(fail("bad_request", "Invalid directory"));
    const backend = await getBackend();
    if (!backend.listDir) return notImplemented(reply);
    const list = backend.listDir.bind(backend);
    let listing;
    try {
      listing = await serial(learner, () => list(learner, dir));
    } catch (err) {
      if (err instanceof SandboxNotRunningError) return noShell(reply);
      throw err;
    }
    if (!listing) return reply.status(404).send(fail("not_found", "No such directory"));
    return {
      entries: listing.entries.slice(0, LIST_MAX_ENTRIES).map((e) => ({ ...e, name: e.name.slice(0, MAX_NAME) })),
      truncated: listing.truncated || listing.entries.length > LIST_MAX_ENTRIES,
    };
  });

  // One request for all open workspace folders. The read-only directory calls
  // can run in parallel while the learner-scoped serial queue excludes writes.
  app.get<{ Querystring: { dir?: unknown } }>("/sandbox/files/batch", async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    if (!listAllowed(learner)) return tooMany(reply);
    const dirs = Array.isArray(req.query.dir) ? req.query.dir : req.query.dir === undefined ? [] : [req.query.dir];
    const parsed = dirs.map(parseDir);
    if (!parsed.length || parsed.length > 32 || parsed.some((dir) => dir === null)) {
      return reply.status(400).send(fail("bad_request", "Invalid directory list"));
    }
    const backend = await getBackend();
    if (!backend.listDir) return notImplemented(reply);
    try {
      const listings = await serial(learner, () => Promise.all(parsed.map((dir) => backend.listDir!(learner, dir!))));
      return {
        directories: Object.fromEntries(parsed.map((dir, index) => {
          const listing = listings[index];
          return [dir, listing ? {
            entries: listing.entries.slice(0, LIST_MAX_ENTRIES).map((e) => ({ ...e, name: e.name.slice(0, MAX_NAME) })),
            truncated: listing.truncated || listing.entries.length > LIST_MAX_ENTRIES,
          } : null];
        })),
      };
    } catch (err) {
      if (err instanceof SandboxNotRunningError) return noShell(reply);
      throw err;
    }
  });
}
