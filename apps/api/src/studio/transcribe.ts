import { z } from "zod";
import { OPENROUTER_ORIGIN, TtsError } from "./tts.ts";

const STT_TIMEOUT_MS = 60_000;

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

export async function transcribe(
  audio: Uint8Array,
  format: AudioFormat,
  cfg: SttConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Transcript> {
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
  if (!res.ok) throw new TtsError(`The speech-to-text service answered ${res.status}`, 502);
  const parsed = Transcription.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new TtsError("The speech-to-text service sent no word timings", 502);
  return {
    text: parsed.data.text.trim(),
    words: parsed.data.words.flatMap((word) =>
      word.type === "audio_event" ? [] : [{ text: word.word.trim(), start: word.start, end: word.end }],
    ),
  };
}
