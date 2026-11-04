// Practice code (Python or JavaScript) runs on the server in a locked-down container. A run is live: the client polls its output and sends each typed answer.
export type PyPoll = { output: string; next: number; done: boolean; error?: string };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/sandbox/run${path}`, { credentials: "include", ...init, headers: { "content-type": "application/json" } });
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) throw new Error(body?.error?.message ?? "Could not run the code");
  return body as T;
}

export const startPython = (code: string, language: "python" | "javascript") => call<{ id: string }>("", { method: "POST", body: JSON.stringify({ code, language }) });
export const pollPython = (id: string, from: number) => call<PyPoll>(`/${id}?from=${from}`);
export const sendPythonLine = (id: string, line: string) => call<{ ok: boolean }>(`/${id}/input`, { method: "POST", body: JSON.stringify({ line }) });
export const stopPython = (id: string) => call<{ ok: boolean }>(`/${id}`, { method: "DELETE" });
