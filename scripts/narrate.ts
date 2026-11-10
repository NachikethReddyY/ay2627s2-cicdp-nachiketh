// Renders one MP3 per lesson step from the step's narration text, so `media:narration` can store them.
// Run locally with your own keys: node scripts/narrate.ts --lesson <slug> --out <dir> [--provider elevenlabs|openai]
// Keys come only from environment variables. They are never printed, logged or written to disk.
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export type Provider = "elevenlabs" | "openai";
export type Env = Record<string, string | undefined>;
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Io = { log: (line: string) => void; error: (line: string) => void };

export type TtsConfig =
  | { provider: "elevenlabs"; apiKey: string; voiceId: string; modelId: string }
  | { provider: "openai"; baseUrl: string; model: string; voice: string };

// Usage problems exit 2; missing configuration and other failures exit 1.
class UsageError extends Error {}
class ConfigError extends Error {}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nonEmpty = (v: string | undefined): v is string => v !== undefined && v.trim() !== "";
const hashText = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Picks the provider: the --provider flag, else ElevenLabs when its key is set, else the OpenAI-compatible server. */
export function chooseProvider(flag: string | undefined, env: Env): Provider {
  if (flag !== undefined) {
    if (flag === "elevenlabs" || flag === "openai") return flag;
    throw new UsageError(`--provider must be elevenlabs or openai, got "${flag}"`);
  }
  if (nonEmpty(env.ELEVENLABS_API_KEY)) return "elevenlabs";
  if (nonEmpty(env.TTS_BASE_URL)) return "openai";
  throw new ConfigError(
    "No TTS provider configured. Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID for ElevenLabs, or TTS_BASE_URL and TTS_VOICE for an OpenAI-compatible server.",
  );
}

/** Reads the provider's settings from the environment. Error messages name variables, never their values. */
export function providerConfig(provider: Provider, env: Env): TtsConfig {
  if (provider === "elevenlabs") {
    const missing = ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"].filter((k) => !nonEmpty(env[k]));
    if (missing.length) throw new ConfigError(`--provider elevenlabs needs ${missing.join(" and ")} set`);
    return {
      provider,
      apiKey: env.ELEVENLABS_API_KEY!,
      voiceId: env.ELEVENLABS_VOICE_ID!,
      modelId: nonEmpty(env.ELEVENLABS_MODEL_ID) ? env.ELEVENLABS_MODEL_ID : "eleven_multilingual_v2",
    };
  }
  const missing = ["TTS_BASE_URL", "TTS_VOICE"].filter((k) => !nonEmpty(env[k]));
  if (missing.length) throw new ConfigError(`--provider openai needs ${missing.join(" and ")} set`);
  return {
    provider,
    baseUrl: env.TTS_BASE_URL!,
    voice: env.TTS_VOICE!,
    model: nonEmpty(env.TTS_MODEL) ? env.TTS_MODEL : "tts-1",
  };
}

/** The HTTP request for one step's text. */
export function ttsRequest(cfg: TtsConfig, text: string): { url: string; init: RequestInit } {
  if (cfg.provider === "elevenlabs") {
    return {
      url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}`,
      init: {
        method: "POST",
        headers: { "xi-api-key": cfg.apiKey, Accept: "audio/mpeg", "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: cfg.modelId }),
      },
    };
  }
  return {
    url: `${cfg.baseUrl.replace(/\/+$/, "")}/v1/audio/speech`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, voice: cfg.voice, input: text, response_format: "mp3" }),
    },
  };
}

type Step = { idx: number; text: string | undefined };

async function readSteps(lessonFile: string): Promise<Step[]> {
  const lesson = JSON.parse(await readFile(lessonFile, "utf8")) as { steps?: unknown };
  if (!Array.isArray(lesson.steps)) throw new Error(`${lessonFile} has no steps array`);
  const seen = new Set<number>();
  return lesson.steps.map((s: { idx?: unknown; secret?: { narration?: unknown } }) => {
    if (!Number.isInteger(s.idx) || (s.idx as number) < 0) throw new Error(`${lessonFile} has a step without a valid idx`);
    const idx = s.idx as number;
    if (seen.has(idx)) throw new Error(`${lessonFile} has more than one step with idx ${idx}`);
    seen.add(idx);
    const text = typeof s.secret?.narration === "string" && s.secret.narration.trim() !== "" ? s.secret.narration : undefined;
    return { idx, text };
  });
}

async function exists(path: string) {
  return access(path).then(() => true, () => false);
}

async function readManifest(path: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
  } catch {
    return {}; // Missing or unreadable: every step renders again.
  }
}

/** Runs the script. Returns the exit code. */
export async function run(argv: string[], env: Env, fetchImpl: Fetch, io: Io): Promise<number> {
  try {
    let values: { lesson?: string; out?: string; "lesson-file"?: string; provider?: string };
    try {
      ({ values } = parseArgs({
        args: argv,
        strict: true,
        options: { lesson: { type: "string" }, out: { type: "string" }, "lesson-file": { type: "string" }, provider: { type: "string" } },
      }));
    } catch (e) {
      throw new UsageError(e instanceof Error ? e.message : String(e));
    }
    if (!values.out) throw new UsageError("--out <dir> is required");
    if (!values.lesson && !values["lesson-file"]) throw new UsageError("--lesson <slug> or --lesson-file <path> is required");

    const provider = chooseProvider(values.provider, env);
    const cfg = providerConfig(provider, env);
    const lessonFile = values["lesson-file"] ?? join(repoRoot, "worlds/codequest/lessons", `${values.lesson}.json`);
    const steps = await readSteps(lessonFile);

    const outDir = resolve(values.out);
    await mkdir(outDir, { recursive: true });
    const manifestPath = join(outDir, "narration.json");
    const previous = await readManifest(manifestPath);
    const manifest: Record<string, string> = {};

    let rendered = 0;
    let skipped = 0;
    let failed = 0;
    let missing = 0;
    for (const step of steps) {
      const mp3 = join(outDir, `${step.idx}.mp3`);
      if (step.text === undefined) {
        missing++;
        await rm(mp3, { force: true }); // An old file would be stored for text the lesson no longer has.
        continue;
      }
      const hash = hashText(step.text);
      if (previous[String(step.idx)] === hash && (await exists(mp3))) {
        manifest[String(step.idx)] = hash;
        skipped++;
        continue;
      }
      try {
        const req = ttsRequest(cfg, step.text);
        const res = await fetchImpl(req.url, req.init);
        if (!res.ok) throw new Error(`provider returned HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength === 0) throw new Error("provider returned an empty body");
        await writeFile(mp3, bytes);
        manifest[String(step.idx)] = hash;
        rendered++;
      } catch (e) {
        failed++;
        io.error(`step ${step.idx}: ${e instanceof Error ? e.message : String(e)}`);
        await rm(mp3, { force: true }); // A failed step has no audio, so the next run renders it again.
      }
    }

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    io.log(`${provider}: rendered ${rendered}, skipped ${skipped} unchanged, failed ${failed}, no narration ${missing} -> ${outDir}`);
    return failed > 0 ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.error(`${e.message}\nusage: node scripts/narrate.ts --lesson <slug> --out <dir> [--lesson-file <path>] [--provider elevenlabs|openai]`);
      return 2;
    }
    io.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await run(process.argv.slice(2), process.env, (url, init) => fetch(url, init), {
    log: (l) => console.log(l),
    error: (l) => console.error(l),
  });
  process.exitCode = code;
}
