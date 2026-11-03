import { createHash } from "node:crypto";
import { env } from "../env.ts";
import { isSafe } from "../safety/moderation.ts";
import { reserveAiSpend } from "../config/budget.ts";
import { tiers } from "../config/tiers.ts";
import { saveMedia } from "./service.ts";
import { storage } from "./storage.ts";
import { db } from "../db/client.ts";
import { imageGenerations, lessonMedia } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { and, eq, gt, sql } from "drizzle-orm";

export type ImageResult = { status: "fallback"; description: string; marked: true } | { status: "ready"; key: string };
export type HttpClient = (url: string, init: RequestInit) => Promise<Response>;
const fetchHttp: HttpClient = (url, init) => fetch(url, init);
const ready = () => !!(env.IMAGE_BASE_URL && env.IMAGE_API_KEY && env.IMAGE_MODEL);

/** Accept only server-generated content. Callers pass outline/visual spec descriptions, never request text. */
type ChatMessage = { content?: string | Array<{ type?: string; text?: string; image_url?: { url?: string }; url?: string }> | null; images?: Array<{ image_url?: { url?: string } }> };
/** Finds the picture in a chat reply: message.images, a content part, a Markdown image, or a bare data URL. */
function chatImage(message: ChatMessage): string | undefined {
  const fromImages = message.images?.[0]?.image_url?.url;
  if (fromImages) return fromImages;
  if (Array.isArray(message.content)) {
    const part = message.content.find((p) => p.type === "image_url" || p.type === "image");
    return part?.image_url?.url ?? part?.url;
  }
  const text = message.content ?? "";
  const md = text.match(/!\[[^\]]*\]\((data:image\/[^)\s]+)\)/i);
  return md ? md[1] : text.trim();
}

type ImageInput = {
  lessonVersionId: string;
  learnerId: string;
  stepId?: string;
  prompt: string;
  description: string;
  tier: keyof typeof tiers;
};

// Concurrent reads of the same prompt (prewarm racing a lesson read) share one provider call instead of paying twice.
// shortcut: per process only; another API instance can still start its own call, the promptHash unique index stops a duplicate save.
const inFlight = new Map<string, Promise<ImageResult>>();

export function generateImage(input: ImageInput, http: HttpClient = fetchHttp): Promise<ImageResult> {
  const key = `${input.learnerId}:${createHash("sha256").update(input.prompt).digest("hex")}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = generateImageOnce(input, http).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function generateImageOnce(input: ImageInput, http: HttpClient): Promise<ImageResult> {
  const fallback: ImageResult = { status: "fallback", description: input.description, marked: true };
  if (!ready()) return fallback;
  const hash = createHash("sha256").update(input.prompt).digest("hex");
  const [cached] = await db.select({ key: lessonMedia.key, status: lessonMedia.status }).from(lessonMedia).where(eq(lessonMedia.promptHash, hash)).limit(1);
  if (cached?.status === "ready" && cached.key) return { status: "ready", key: cached.key };
  // Moderation runs only for prompts we would send to the provider; a stored image already passed it when saved.
  if (!(await isSafe(input.prompt))) return fallback;
  // A prompt that failed in the last 24 hours (for anyone) is not paid for again.
  const [failed] = await db.select({ id: imageGenerations.id }).from(imageGenerations)
    .where(and(eq(imageGenerations.promptHash, hash), eq(imageGenerations.status, "failed"), gt(imageGenerations.createdAt, sql`now() - interval '24 hours'`))).limit(1);
  if (failed) return fallback;
  // Take the learner's daily slot under a per-learner lock so parallel reads cannot both pass the cap.
  // The row is "ready" from the start (so it counts) and flips to "failed" if generation does not finish.
  const slot = await withTx(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.learnerId}))`);
    const { rows: [{ n }] } = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM image_generations WHERE learner_id = ${input.learnerId} AND status = 'ready' AND created_at > now() - interval '24 hours'`);
    if (n >= tiers[input.tier].imagesPerDay) return null;
    const [row] = await tx.insert(imageGenerations).values({ learnerId: input.learnerId, promptHash: hash, status: "ready" }).returning({ id: imageGenerations.id });
    return row!.id;
  });
  if (!slot) return fallback;
  try {
    await reserveAiSpend(env.IMAGE_ESTIMATE_USD);
  } catch {
    await db.delete(imageGenerations).where(eq(imageGenerations.id, slot)); // nothing was called, so nothing is recorded
    return fallback; // over budget or kill switch: show the description card, never a network call
  }
  try {
    const base = env.IMAGE_BASE_URL!.replace(/\/$/, "");
    const signal = AbortSignal.timeout(30_000);
    const headers = { authorization: `Bearer ${env.IMAGE_API_KEY}`, "content-type": "application/json" };
    const response = env.IMAGE_API_STYLE === "chat"
      ? await http(`${base}/chat/completions`, { method: "POST", signal, headers, body: JSON.stringify({ model: env.IMAGE_MODEL, modalities: ["image", "text"], messages: [{ role: "user", content: `Create a safe educational illustration. ${input.prompt}` }] }) })
      : await http(`${base}/images/generations`, { method: "POST", signal, headers, body: JSON.stringify({ model: env.IMAGE_MODEL, prompt: input.prompt, response_format: "b64_json" }) });
    if (!response.ok) throw new Error("provider error");
    const data = JSON.parse(await readCapped(response)) as { data?: Array<{ b64_json?: string }>; choices?: Array<{ message?: ChatMessage }> };
    const message = data.choices?.[0]?.message;
    let encoded = data.data?.[0]?.b64_json ?? (message ? chatImage(message) : undefined);
    if (env.IMAGE_API_STYLE === "chat") encoded = encoded?.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("no image");
    const bytes = Buffer.from(encoded, "base64");
    const contentType = sniff(bytes);
    if (!contentType) throw new Error("not a supported image");
    // Moderation errors/refusals fail closed before persistence.
    if (!(await isSafe(input.prompt))) throw new Error("refused");
    const key = await saveMedia({ lessonVersionId: input.lessonVersionId, stepId: input.stepId, kind: "image", body: bytes, contentType, promptHash: hash });
    return { status: "ready", key };
  } catch {
    await db.update(imageGenerations).set({ status: "failed" }).where(eq(imageGenerations.id, slot));
    return fallback;
  }
}

const MAX_BODY = 4 * 1024 * 1024;
async function readCapped(res: Response): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += c.byteLength;
    if (size > MAX_BODY) throw new Error("provider response too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const sniff = (b: Buffer) =>
  b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
  : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "image/jpeg"
  : b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" ? "image/webp"
  : null;

type DocBlock = { type?: unknown; id?: unknown; props?: Record<string, unknown> };

/**
 * Client-safe copy of a visual doc. This is the only place the server-only image `prompt` is stripped:
 * every "generate" image is fulfilled (or falls back) and rewritten to "generated" / "generated-pending".
 * Image blocks that are broken, or that already claim a client-only source, are dropped; nothing throws.
 * Call it on the stored doc right before it leaves the API.
 */
/**
 * Generates every `generate` image in a stored document once, while the lesson is being written, so the
 * learner's first read is served from the image cache. A failed image is left as its description card.
 */
export async function prewarmDocImages(doc: unknown, opts: { lessonVersionId: string; learnerId: string; tier: keyof typeof tiers }): Promise<void> {
  const blocks = (doc as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks)) return;
  for (const block of blocks as Array<{ type?: string; props?: { source?: string; prompt?: string; alt?: string } }>) {
    if (block?.type !== "image" || block.props?.source !== "generate" || !block.props.prompt) continue;
    await generateImage({ ...opts, prompt: block.props.prompt, description: block.props.alt ?? "" }).catch(() => undefined);
  }
}

export async function resolveDocImages(
  doc: unknown,
  opts: { lessonVersionId: string; learnerId: string; tier: keyof typeof tiers; stepId?: string },
  http?: HttpClient,
): Promise<unknown> {
  const blocks = (doc as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks)) return doc;
  const out: unknown[] = [];
  for (const b of blocks as DocBlock[]) {
    if (b?.type !== "image") { out.push(b); continue; }
    const p = b.props;
    if (p?.source === "asset") { out.push(b); continue; }
    if (p?.source !== "generate" || typeof p.prompt !== "string" || typeof p.alt !== "string") continue;
    const base = { alt: p.alt, ...(typeof p.caption === "string" ? { caption: p.caption } : {}) };
    let props: Record<string, unknown> = { source: "generated-pending", ...base };
    try {
      const r = await generateImage({ ...opts, prompt: p.prompt, description: p.alt }, http);
      if (r.status === "ready" && storage) props = { source: "generated", url: await storage.signGet(r.key), ...base };
    } catch { /* provider, storage or db failure: keep the description card */ }
    out.push({ type: "image", id: b.id, props });
  }
  return { ...(doc as object), blocks: out };
}
