export const OPENROUTER_ORIGIN = "https://openrouter.ai";
const TTS_TIMEOUT_MS = 60_000;

export type TtsConfig = { apiKey: string; model: string; voice: string; sampleRate: number };

export class TtsError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([header, pcm]));
}

export async function synthesize(text: string, cfg: TtsConfig, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchImpl(`${OPENROUTER_ORIGIN}/api/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, input: text, voice: cfg.voice, response_format: "pcm" }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
  } catch {
    throw new TtsError("The voice service could not be reached", 502);
  }
  if (!res.ok) throw new TtsError(`The voice service answered ${res.status}`, 502);
  if (!(res.headers.get("content-type") ?? "").startsWith("audio/pcm")) throw new TtsError("The voice service sent no pcm audio", 502);
  const pcm = new Uint8Array(await res.arrayBuffer());
  if (pcm.length === 0) throw new TtsError("The voice service sent no pcm audio", 502);
  return pcmToWav(pcm, cfg.sampleRate);
}
