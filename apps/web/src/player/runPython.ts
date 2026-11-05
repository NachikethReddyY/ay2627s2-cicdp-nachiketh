// Practice code (Python or JavaScript) runs on the server in a locked-down container. A run is live: the client polls its output and sends each typed answer.
// `passed` is the server's verdict, sent only for a Check run once it has ended.
export type PyPoll = { output: string; next: number; done: boolean; error?: string; passed?: boolean };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/sandbox/run${path}`, { credentials: "include", ...init, headers: { "content-type": "application/json" } });
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) throw new Error(body?.error?.message ?? "Could not run the code");
  return body as T;
}

// With `lessonId` the run is a Check: the server compares the output and records the lesson as complete on a match.
export const startPython = (code: string, language: "python" | "javascript", lessonId?: string) =>
  call<{ id: string }>("", { method: "POST", body: JSON.stringify({ code, language, lessonId }) });
/** A Check passes only on the server's word; a missing verdict (an older server, a dropped field) is a fail. */
export const checkPassed = (p: Pick<PyPoll, "error" | "passed">) => !p.error && p.passed === true;
export const pollPython = (id: string, from: number) => call<PyPoll>(`/${id}?from=${from}`);
export const sendPythonLine = (id: string, line: string) => call<{ ok: boolean }>(`/${id}/input`, { method: "POST", body: JSON.stringify({ line }) });
export const stopPython = (id: string) => call<{ ok: boolean }>(`/${id}`, { method: "DELETE" });
