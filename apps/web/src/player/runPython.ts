import { type CheckResponse, type PracticeLanguage } from "./live/checkModel.ts";

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

export const startPython = (code: string, language: PracticeLanguage, lessonId?: string, signal?: AbortSignal) =>
  call<{ id: string }>("/api/sandbox/run", { method: "POST", body: JSON.stringify({ code, language, lessonId }), signal });

export const checkPractice = (input: { code: string; language: PracticeLanguage; lessonId: string; versionId?: string; revision?: string }) =>
  call<CheckResponse>("/api/sandbox/check", { method: "POST", body: JSON.stringify(input) });

export type DesignFeedback = { line: number; note: string };
export const requestDesignFeedback = (input: { lessonId: string; code: string; receipt: string }) =>
  call<{ feedback: DesignFeedback | null }>("/api/practice/design-feedback", { method: "POST", body: JSON.stringify(input) });

export type LintFinding = { ruleId: string; line: number; column: number; message: string };
export const lintPractice = (code: string, language: PracticeLanguage) =>
  call<{ findings: LintFinding[] }>("/api/practice/lint", { method: "POST", body: JSON.stringify({ code, language }) });

export const checkPassed = (p: Pick<PyPoll, "error" | "passed">) => !p.error && p.passed === true;
export const pollPython = (id: string, from: number, signal?: AbortSignal) => call<PyPoll>(`/api/sandbox/run/${id}?from=${from}`, { signal });
export const sendPythonLine = (id: string, line: string) => call<{ ok: boolean }>(`/api/sandbox/run/${id}/input`, { method: "POST", body: JSON.stringify({ line }) });
export const stopPython = (id: string, signal?: AbortSignal) => call<{ ok: boolean }>(`/api/sandbox/run/${id}`, { method: "DELETE", signal });

export const putFile = (name: "solution.py" | "solution.js" | "solution.ts", content: string) =>
  call<unknown>(`/api/sandbox/files/${name}`, { method: "PUT", body: JSON.stringify({ content }) }).then(() => undefined);

export type DirEntry = { name: string; type: "file" | "dir" | "link" | "other"; size: number };
export const listFiles = (dir?: string) =>
  call<{ entries: DirEntry[]; truncated: boolean }>(`/api/sandbox/files${dir === undefined ? "" : `?dir=${encodeURIComponent(dir)}`}`);

export const listFileDirectories = (directories: string[]) => {
  const query = directories.map((dir) => `dir=${encodeURIComponent(dir)}`).join("&");
  return call<{ directories: Record<string, { entries: DirEntry[]; truncated: boolean } | null> }>(`/api/sandbox/files/batch?${query}`);
};

export const getWorkspaceFile = (path: string) =>
  call<{ content: string }>(`/api/sandbox/workspace-file?path=${encodeURIComponent(path)}`);

export const WORKSPACE_READ_BATCH = 64;
export type WorkspaceFileSkip = { path: string; reason: "not_found" | "file_too_large" };
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

const KEEPALIVE_BODY_LIMIT = 60 * 1024;

const SAVE_TIMEOUT_MS = 15_000;

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

export const moveWorkspaceFile = (source: string, targetDir: string) =>
  call<unknown>("/api/sandbox/workspace-file/move", { method: "POST", body: JSON.stringify({ source, targetDir }) }).then(() => undefined);

export type GuideWidget =
  | { type: "hint"; title: string; body: string }
  | { type: "steps"; title: string; items: string[] }
  | { type: "question"; text: string };
export type GuideChatMessage = { role: "user" | "assistant"; content: string };
export const askEditorGuide = (input: {
  lessonId?: string;
  fileName: string;
  projectRoot: string;
  language: string;
  code: string;
  selection: string;
  messages: GuideChatMessage[];
  finding?: { ruleId: string; line: number; column?: number };
}) => call<{ guide: { message: string; widgets: GuideWidget[] } }>("/api/guide/chat", {
  method: "POST",
  body: JSON.stringify(input),
});
