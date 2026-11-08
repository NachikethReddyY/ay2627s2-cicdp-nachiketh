// Practice code (Python or JavaScript) runs on the server in a locked-down container. A run is live: the client polls its output and sends each typed answer.
// `passed` is the server's verdict, sent only for a Check run once it has ended.
export type PyPoll = { output: string; next: number; done: boolean; error?: string; passed?: boolean };

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function call<T>(fullPath: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(fullPath, { credentials: "include", ...init, headers: { "content-type": "application/json" } });
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) throw new ApiError(body?.error?.message ?? "Could not run the code", res.status);
  return body as T;
}

// With `lessonId` the run is a Check: the server compares the output and records the lesson as complete on a match.
export const startPython = (code: string, language: "python" | "javascript", lessonId?: string) =>
  call<{ id: string }>("/api/sandbox/run", { method: "POST", body: JSON.stringify({ code, language, lessonId }) });
/** A Check passes only on the server's word; a missing verdict (an older server, a dropped field) is a fail. */
export const checkPassed = (p: Pick<PyPoll, "error" | "passed">) => !p.error && p.passed === true;
export const pollPython = (id: string, from: number) => call<PyPoll>(`/api/sandbox/run/${id}?from=${from}`);
export const sendPythonLine = (id: string, line: string) => call<{ ok: boolean }>(`/api/sandbox/run/${id}/input`, { method: "POST", body: JSON.stringify({ line }) });
export const stopPython = (id: string) => call<{ ok: boolean }>(`/api/sandbox/run/${id}`, { method: "DELETE" });

/** Writes the learner's editor file into their sandbox home (PUT /api/sandbox/files/:name). */
export const putFile = (name: "solution.py" | "solution.js", content: string) =>
  call<unknown>(`/api/sandbox/files/${name}`, { method: "PUT", body: JSON.stringify({ content }) }).then(() => undefined);

export type DirEntry = { name: string; type: "file" | "dir" | "link" | "other"; size: number };
/** One directory level of the learner's sandbox home (or of `dir`, relative to it). */
export const listFiles = (dir?: string) =>
  call<{ entries: DirEntry[]; truncated: boolean }>(`/api/sandbox/files${dir === undefined ? "" : `?dir=${encodeURIComponent(dir)}`}`);

/** Lists several open workspace folders in one request. */
export const listFileDirectories = (directories: string[]) => {
  const query = directories.map((dir) => `dir=${encodeURIComponent(dir)}`).join("&");
  return call<{ directories: Record<string, { entries: DirEntry[]; truncated: boolean } | null> }>(`/api/sandbox/files/batch?${query}`);
};

/** Reads one editable file from the authenticated learner workspace. */
export const getWorkspaceFile = (path: string) =>
  call<{ content: string }>(`/api/sandbox/workspace-file?path=${encodeURIComponent(path)}`);

/** Most paths one batch read accepts (the server's MAX_BATCH_READ). */
export const WORKSPACE_READ_BATCH = 64;
export type WorkspaceFileSkip = { path: string; reason: "not_found" | "file_too_large" };
/**
 * Reads many editable files in one request per 64 paths, sent one batch at a time.
 * Missing and oversized files come back in `skipped` instead of failing the read.
 */
export async function readWorkspaceFiles(paths: string[]): Promise<{ files: { path: string; content: string }[]; skipped: WorkspaceFileSkip[] }> {
  const files: { path: string; content: string }[] = [];
  const skipped: WorkspaceFileSkip[] = [];
  for (let i = 0; i < paths.length; i += WORKSPACE_READ_BATCH) {
    const batch = await call<{ files: { path: string; content: string }[]; skipped: WorkspaceFileSkip[] }>("/api/sandbox/workspace-files/read", {
      method: "POST",
      body: JSON.stringify({ paths: paths.slice(i, i + WORKSPACE_READ_BATCH) }),
    });
    files.push(...batch.files);
    skipped.push(...batch.skipped);
  }
  return { files, skipped };
}

// A keepalive request may outlive the page, but browsers cap the whole request (body and headers) at 64 KiB.
const KEEPALIVE_BODY_LIMIT = 60 * 1024;

// A save that never settles would block every later save, so each attempt is aborted after this long.
const SAVE_TIMEOUT_MS = 15_000;

/**
 * Saves one editable file to the authenticated learner workspace.
 * `keepalive` lets the save finish after the page unloads. Bodies at or over the cap use a normal request instead.
 * A keepalive save the browser rejects with a TypeError (in-flight keepalive quota used up) is retried once without keepalive.
 * A save that takes longer than SAVE_TIMEOUT_MS rejects.
 */
export const putWorkspaceFile = (path: string, content: string, options: { keepalive?: boolean } = {}) => {
  const body = JSON.stringify({ path, content });
  const wantKeepalive = options.keepalive === true && new TextEncoder().encode(body).length < KEEPALIVE_BODY_LIMIT;
  const send = (keepalive: boolean) => call<unknown>("/api/sandbox/workspace-file", {
    method: "PUT",
    body,
    keepalive,
    signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
  });
  const attempt = wantKeepalive
    ? send(true).catch((error: unknown) => {
      if (error instanceof TypeError) return send(false);
      throw error;
    })
    : send(false);
  return attempt.then(() => undefined);
};

/** Moves one file into an existing workspace folder. */
export const moveWorkspaceFile = (source: string, targetDir: string) =>
  call<unknown>("/api/sandbox/workspace-file/move", { method: "POST", body: JSON.stringify({ source, targetDir }) }).then(() => undefined);

export type GuideWidget =
  | { type: "hint"; title: string; body: string }
  | { type: "steps"; title: string; items: string[] }
  | { type: "question"; text: string };
export type GuideChatMessage = { role: "user" | "assistant"; content: string };
export const askEditorGuide = (input: {
  fileName: string;
  projectRoot: string;
  language: string;
  code: string;
  selection: string;
  messages: GuideChatMessage[];
}) => call<{ guide: { message: string; widgets: GuideWidget[] } }>("/api/dev/guide-chat", {
  method: "POST",
  body: JSON.stringify(input),
});
