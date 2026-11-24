import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { env } from "../env.ts";
import { OPENROUTER_ORIGIN, TtsError } from "./tts.ts";

const STT_TIMEOUT_MS = 60_000;
const Usage = z.object({ usage: z.object({ cost: z.number().nonnegative().lt(1e12) }) });

const Transcription = z.object({
  text: z.string(),
  words: z.array(
    z.object({
      word: z.string(),
      start: z.number(),
      end: z.number(),
      type: z.enum(["word", "audio_event"]).optional(),
    }),
  ),
});

export type SttConfig = { apiKey: string; model: string };

export type AudioFormat = "wav" | "mp3";

export type SpokenWord = { text: string; start: number; end: number };

export type Transcript = { text: string; words: SpokenWord[] };

async function captureTranscription(
  model: string,
  latency: number,
  status: number | undefined,
  cost: number | undefined,
  failed: boolean,
  fetchImpl: typeof fetch,
) {
  const { POSTHOG_PROJECT_TOKEN: token, POSTHOG_HOST: host } = env;
  if (!token || !host) return;
  const id = randomUUID();
  try {
    const response = await fetchImpl(new URL("/capture/", host), {
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
      body: JSON.stringify({
        api_key: token,
        event: "$ai_generation",
        properties: {
          distinct_id: "learnslop-api",
          $process_person_profile: false,
          $geoip_disable: true,
          $ai_trace_id: id,
          $ai_span_id: id,
          $ai_provider: "openrouter",
          $ai_model: model,
          $ai_latency: latency,
          $ai_is_error: failed,
          ...(status === undefined ? {} : { $ai_http_status: status }),
          modality: "audio",
          audio_operation: "transcription",
          pricing_status: cost === undefined ? "unpriced" : "priced",
          ...(cost === undefined ? {} : { $ai_total_cost_usd: cost, pricing_source: "openrouter" }),
        },
      }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Transcription analytics unavailable");
  } catch {
    console.warn("Could not capture transcription telemetry");
  }
}

export async function transcribe(
  audio: Uint8Array,
  format: AudioFormat,
  cfg: SttConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Transcript> {
  const started = performance.now();
  let status: number | undefined;
  let cost: number | undefined;
  let failed = true;
  try {
    let res: Response;
    try {
      res = await fetchImpl(`${OPENROUTER_ORIGIN}/api/v1/audio/transcriptions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          input_audio: { data: Buffer.from(audio).toString("base64"), format },
          language: "en",
          response_format: "verbose_json",
          timestamp_granularities: ["word"],
        }),
        signal: AbortSignal.timeout(STT_TIMEOUT_MS),
      });
    } catch {
      throw new TtsError("The speech-to-text service could not be reached", 502);
    }
    status = res.status;
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new TtsError(`The speech-to-text service answered ${res.status}`, 502);
    }
    const body: unknown = await res.json().catch(() => null);
    cost = Usage.safeParse(body).data?.usage.cost;
    const parsed = Transcription.safeParse(body);
    if (!parsed.success) throw new TtsError("The speech-to-text service sent no word timings", 502);
    failed = false;
    return {
      text: parsed.data.text.trim(),
      words: parsed.data.words.flatMap((word) =>
        word.type === "audio_event" ? [] : [{ text: word.word.trim(), start: word.start, end: word.end }],
      ),
    };
  } finally {
    await captureTranscription(cfg.model, (performance.now() - started) / 1_000, status, cost, failed, fetchImpl);
  }
}
