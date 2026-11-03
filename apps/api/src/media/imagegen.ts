import { createHash } from "node:crypto";
import { env } from "../env.ts";
import { isSafe } from "../safety/moderation.ts";
import { reserveAiSpend } from "../config/budget.ts";
import { tiers } from "../config/tiers.ts";
import { saveMedia } from "./service.ts";
import { db } from "../db/client.ts";
import { lessonMedia } from "../db/schema.ts";
import { eq } from "drizzle-orm";

export type ImageResult = { status: "fallback"; description: string; marked: true } | { status: "ready"; key: string };
export type HttpClient = (url: string, init: RequestInit) => Promise<Response>;
const fetchHttp: HttpClient = (url, init) => fetch(url, init);
const ready = () => !!(env.IMAGE_BASE_URL && env.IMAGE_API_KEY && env.IMAGE_MODEL);

/** Accept only server-generated content. Callers pass outline/visual spec descriptions, never request text. */
export async function generateImage(input: {
  lessonVersionId: string;
  stepId?: string;
  prompt: string;
  description: string;
  tier: keyof typeof tiers;
}, http: HttpClient = fetchHttp): Promise<ImageResult> {
  const fallback: ImageResult = { status: "fallback", description: input.description, marked: true };
  if (!ready()) return fallback;
  if (!(await isSafe(input.prompt))) return fallback;
  const hash = createHash("sha256").update(input.prompt).digest("hex");
  const [cached] = await db.select({ key: lessonMedia.key, status: lessonMedia.status }).from(lessonMedia).where(eq(lessonMedia.promptHash, hash)).limit(1);
  if (cached?.status === "ready" && cached.key) return { status: "ready", key: cached.key };
  // Image spend is reserved before network use; the configured per-tier cap remains authoritative.
  if (tiers[input.tier].imagesPerDay <= 0) return fallback;
  try {
    await reserveAiSpend();
  } catch {
    return fallback; // over budget or kill switch: show the description card, never a network call
  }
  const base = env.IMAGE_BASE_URL!;
  const response = env.IMAGE_API_STYLE === "chat"
    ? await http(`${base.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${env.IMAGE_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: env.IMAGE_MODEL, messages: [{ role: "user", content: `Create a safe educational illustration. ${input.prompt}` }] }) })
    : await http(`${base.replace(/\/$/, "")}/images/generations`, { method: "POST", headers: { authorization: `Bearer ${env.IMAGE_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: env.IMAGE_MODEL, prompt: input.prompt, response_format: "b64_json" }) });
  if (!response.ok) return fallback;
  const data = await response.json() as { data?: Array<{ b64_json?: string }> ; choices?: Array<{ message?: { content?: string } }> };
  const encoded = data.data?.[0]?.b64_json ?? data.choices?.[0]?.message?.content;
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return fallback;
  const bytes = Buffer.from(encoded, "base64");
  // Moderation errors/refusals fail closed before persistence.
  if (!(await isSafe(input.prompt))) return fallback;
  const key = await saveMedia({ lessonVersionId: input.lessonVersionId, stepId: input.stepId, kind: "image", body: bytes, contentType: "image/png", promptHash: hash });
  return { status: "ready", key };
}
