const SOURCE_HOSTS = new Set(["docs.python.org"]);
const SOURCE_CHARS = 12_000;
const SOURCE_TIMEOUT_MS = 10_000;
const SOURCE_START = "5. Data Structures";

export class SourceError extends Error {}

export function allowedSourceUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === "https:" && SOURCE_HOSTS.has(url.hostname) ? url : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " ", "#39": "'", "#x27": "'" };

export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#39|#x27|amp|lt|gt|quot|nbsp);/g, (_, name: string) => ENTITIES[name] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
  const start = text.indexOf(SOURCE_START);
  return (start > 0 ? text.slice(start) : text).slice(0, SOURCE_CHARS);
}

export async function fetchSource(raw: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = allowedSourceUrl(raw);
  if (!url) throw new SourceError("Only https links to docs.python.org can be used as a source");
  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  } catch {
    throw new SourceError("The source page could not be fetched");
  }
  if (!res.ok) throw new SourceError(`The source page answered ${res.status}`);
  const text = htmlToText(await res.text());
  if (!text) throw new SourceError("The source page had no readable text");
  return text;
}
