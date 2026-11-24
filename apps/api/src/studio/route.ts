import type { FastifyInstance, FastifyReply } from "fastify";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { reserveAiSpend } from "../config/budget.ts";
import { env } from "../env.ts";
import { callEngine, EngineError } from "../engine-client/client.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { fetchSource, SourceError } from "./source.ts";
import { synthesize, TtsError, type TtsConfig } from "./tts.ts";
import { transcribe, type AudioFormat, type SttConfig, type Transcript } from "./transcribe.ts";
import { CuedEdit, placeEdits } from "./edits.ts";

const Plan = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(300),
  sections: z
    .array(z.object({ goal: z.string().min(1).max(200), concepts: z.array(z.string().min(1).max(60)).min(1).max(5) }))
    .min(3)
    .max(6),
});
const PlanBody = z.object({ topic: z.string().min(1).max(200), sourceUrl: z.string().min(1).max(500) });
const ScriptBody = z.object({ plan: Plan });
const AudioBody = z.object({ segments: z.array(z.object({ text: z.string().min(1).max(600) })).min(1).max(12) });
const WAV_DATA_URL = "data:audio/wav;base64,";
const AUDIO_DATA_URL = /^data:audio\/(wav|mpeg);base64,/;
const TRANSCRIBE_BODY_LIMIT = 8 * 1024 * 1024;
const TranscribeBody = z.object({ audio: z.string().regex(AUDIO_DATA_URL).max(TRANSCRIBE_BODY_LIMIT) });
const Word = z.object({ text: z.string().max(100), start: z.number().min(0), end: z.number().min(0) });
const EditsBody = z
  .object({
    plan: Plan,
    segments: z.array(z.object({ text: z.string().min(1).max(600) })).min(1).max(12),
    transcripts: z.array(z.object({ words: z.array(Word).max(400) })).min(1).max(12),
  })
  .refine((body) => body.segments.length === body.transcripts.length);
const EngineEdits = z.object({ edits: z.object({ edits: z.array(CuedEdit).min(1).max(24) }) });

export type StudioDeps = {
  resolveLearnerId?: typeof resolveLearnerId;
  callEngine?: typeof callEngine;
  fetchSource?: typeof fetchSource;
  reserveAiSpend?: typeof reserveAiSpend;
  speak?: (text: string) => Promise<Uint8Array>;
  listen?: (audio: Uint8Array, format: AudioFormat) => Promise<Transcript>;
};

function voiceKey(): string {
  if (!env.OPENROUTER_API_KEY) throw new TtsError("OPENROUTER_API_KEY is not set in apps/api/.env", 503);
  return env.OPENROUTER_API_KEY;
}

function ttsConfig(): TtsConfig {
  return { apiKey: voiceKey(), model: env.STUDIO_TTS_MODEL, voice: env.STUDIO_TTS_VOICE, sampleRate: env.STUDIO_TTS_SAMPLE_RATE };
}

function sttConfig(): SttConfig {
  return { apiKey: voiceKey(), model: env.STUDIO_STT_MODEL };
}

const unauthorized = (reply: FastifyReply) => reply.status(401).send({ error: { code: "unauthorized", message: "Sign in to use the studio" } });

function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof TRPCError) {
    const limited = error.code === "TOO_MANY_REQUESTS";
    return reply.status(limited ? 429 : 503).send({ error: { code: limited ? "rate_limited" : "unavailable", message: error.message } });
  }
  if (error instanceof SourceError) return reply.status(400).send({ error: { code: "bad_source", message: error.message } });
  if (error instanceof TtsError) return reply.status(error.status).send({ error: { code: "voice_error", message: error.message } });
  if (error instanceof EngineError) {
    const json = error.body as { error?: unknown } | null;
    const detail = typeof json?.error === "string" ? `: ${json.error}` : "";
    return reply.status(502).send({ error: { code: "engine_error", message: `${error.message}${detail}` } });
  }
  throw error;
}

const audioDataUrl = (wav: Uint8Array) => `${WAV_DATA_URL}${Buffer.from(wav).toString("base64")}`;

export async function studioRoutes(app: FastifyInstance, deps: StudioDeps = {}) {
  const resolve = deps.resolveLearnerId ?? resolveLearnerId;
  const engine = deps.callEngine ?? callEngine;
  const source = deps.fetchSource ?? fetchSource;
  const reserve = deps.reserveAiSpend ?? reserveAiSpend;
  const speak = deps.speak ?? ((text: string) => synthesize(text, ttsConfig()));
  const listen = deps.listen ?? ((audio: Uint8Array, format: AudioFormat) => transcribe(audio, format, sttConfig()));

  app.post("/studio/plan", async (req, reply) => {
    const learnerId = await resolve(req.headers);
    if (!learnerId) return unauthorized(reply);
    const body = PlanBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "bad_request", message: "Give a topic and a docs.python.org link" } });
    try {
      await reserve(env.AI_CALL_ESTIMATE_USD);
      const text = await source(body.data.sourceUrl);
      const data = await engine<{ plan: unknown }>("/v1/studio/plan", { topic: body.data.topic, source: text });
      return { plan: data.plan };
    } catch (error) {
      return failure(reply, error);
    }
  });

  app.post("/studio/script", async (req, reply) => {
    const learnerId = await resolve(req.headers);
    if (!learnerId) return unauthorized(reply);
    const body = ScriptBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "bad_request", message: "The plan does not match the studio plan shape" } });
    try {
      await reserve(env.AI_CALL_ESTIMATE_USD);
      const data = await engine<{ script: unknown }>("/v1/studio/script", { plan: body.data.plan });
      return { script: data.script };
    } catch (error) {
      return failure(reply, error);
    }
  });

  app.post("/studio/audio", async (req, reply) => {
    const learnerId = await resolve(req.headers);
    if (!learnerId) return unauthorized(reply);
    const body = AudioBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "bad_request", message: "Give 1 to 12 segments of up to 600 characters" } });
    try {
      const clips = [];
      for (const [index, segment] of body.data.segments.entries()) {
        await reserve(env.AI_CALL_ESTIMATE_USD);
        clips.push({ index, audio: audioDataUrl(await speak(segment.text)) });
      }
      return { clips };
    } catch (error) {
      return failure(reply, error);
    }
  });

  app.post("/studio/edits", async (req, reply) => {
    const learnerId = await resolve(req.headers);
    if (!learnerId) return unauthorized(reply);
    const body = EditsBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "bad_request", message: "Give the plan, the segments and one transcript per segment" } });
    try {
      await reserve(env.AI_CALL_ESTIMATE_USD);
      const data = EngineEdits.safeParse(
        await engine("/v1/studio/edits", { plan: body.data.plan, segments: body.data.segments.map((s) => s.text) }),
      );
      if (!data.success) return reply.status(502).send({ error: { code: "engine_error", message: "The engine sent edits in the wrong shape" } });
      return {
        edits: placeEdits(
          data.data.edits.edits,
          body.data.transcripts.map((t) => t.words),
          body.data.segments.map((s) => s.text),
        ),
      };
    } catch (error) {
      return failure(reply, error);
    }
  });

  app.post("/studio/transcribe", { bodyLimit: TRANSCRIBE_BODY_LIMIT }, async (req, reply) => {
    const learnerId = await resolve(req.headers);
    if (!learnerId) return unauthorized(reply);
    const body = TranscribeBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "bad_request", message: "Give one segment's audio as a wav or mp3 data URL" } });
    try {
      await reserve(env.AI_CALL_ESTIMATE_USD);
      const [prefix, kind] = AUDIO_DATA_URL.exec(body.data.audio) ?? ["", "wav"];
      const audio = Buffer.from(body.data.audio.slice(prefix.length), "base64");
      return { transcript: await listen(audio, kind === "mpeg" ? "mp3" : "wav") };
    } catch (error) {
      return failure(reply, error);
    }
  });
}
