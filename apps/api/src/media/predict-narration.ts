import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { and, eq, isNull, sql } from "drizzle-orm";
import { reserveAiSpend } from "../config/budget.ts";
import { db } from "../db/client.ts";
import { lessonMedia } from "../db/schema.ts";
import { env } from "../env.ts";
import { recordNarrationCall } from "./narration-spend.ts";
import { storeMedia } from "./service.ts";
import { storage } from "./storage.ts";

const OPENROUTER_SPEECH = "https://openrouter.ai/api/v1/audio/speech";
const MAX_TEXT = 2000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const SPEECH_TIMEOUT_MS = 15_000;
const MP3 = "audio/mpeg";

type Input = { lessonVersionId: string; stepId: string; text: string };
const inFlight = new Map<string, Promise<string | null>>();

export function predictNarration(input: Input): Promise<string | null> {
  const active = inFlight.get(input.stepId);
  if (active) return active;
  const result = loadOrGenerate(input).catch(() => null).finally(() => inFlight.delete(input.stepId));
  inFlight.set(input.stepId, result);
  return result;
}

async function loadOrGenerate({ lessonVersionId, stepId, text }: Input): Promise<string | null> {
  const store = storage;
  if (!store) return null;
  const [stored] = await db.select({ key: lessonMedia.key }).from(lessonMedia)
    .where(and(eq(lessonMedia.lessonVersionId, lessonVersionId), eq(lessonMedia.stepId, stepId),
      isNull(lessonMedia.segment), eq(lessonMedia.kind, "narration"), eq(lessonMedia.status, "ready"))).limit(1);
  if (stored?.key) return store.signGet(stored.key);

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey || env.AI_KILL_SWITCH || !text.trim() || text.length > MAX_TEXT) return null;
  const id = randomUUID();
  const promptHash = createHash("sha256").update(`predict-narration:${lessonVersionId}:${stepId}`).digest("hex");
  const [claimed] = await db.insert(lessonMedia)
    .values({ id, lessonVersionId, stepId, kind: "narration", status: "pending", promptHash, contentType: MP3, bytes: 0 })
    .onConflictDoUpdate({
      target: lessonMedia.promptHash,
      set: { id, status: "pending", createdAt: sql`now()` },
      setWhere: sql`${lessonMedia.status} in ('failed', 'pending') AND ${lessonMedia.createdAt} < now() - interval '24 hours'`,
    })
    .returning({ id: lessonMedia.id });
  if (!claimed) return null;

  let key: string;
  let accounting: Promise<void> | undefined;
  try {
    await reserveAiSpend(env.STUDIO_TTS_ESTIMATE_USD);
    const signal = AbortSignal.timeout(SPEECH_TIMEOUT_MS);
    const model = env.STUDIO_TTS_MODEL;
    const started = performance.now();
    let response: Response | undefined;
    let body: Uint8Array | undefined;
    try {
      response = await fetch(OPENROUTER_SPEECH, {
        method: "POST",
        signal,
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: text, voice: env.STUDIO_TTS_VOICE, response_format: "mp3" }),
      });
      body = await readMp3(response);
    } finally {
      accounting = recordNarrationCall({
        id, apiKey, model, characters: [...text].length, latency: (performance.now() - started) / 1_000,
        response, failed: body === undefined,
      }).catch(() => { console.warn("Could not record narration spend"); });
    }
    key = await storeMedia({ lessonVersionId, stepId, kind: "narration", body, contentType: MP3 }, signal);
    const [saved] = await db.update(lessonMedia).set({ status: "ready", key, bytes: body.byteLength })
      .where(eq(lessonMedia.id, id)).returning({ id: lessonMedia.id });
    if (!saved) return null;
  } catch {
    await db.update(lessonMedia).set({ status: "failed" }).where(eq(lessonMedia.id, id));
    return null;
  } finally {
    await accounting;
  }
  return store.signGet(key);
}

async function readMp3(response: Response): Promise<Uint8Array> {
  const format = response.headers.get("content-type")?.split(";")[0].trim();
  if (!response.ok || format !== MP3 || !response.body) {
    await response.body?.cancel();
    throw new Error("Narration provider did not return MP3 audio");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_AUDIO_BYTES) throw new Error("Narration provider response too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}
