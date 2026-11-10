import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseProvider, providerConfig, run, ttsRequest, type Env, type Fetch } from "./narrate.ts";

const root = await mkdtemp(join(tmpdir(), "narrate-test-"));
after(() => rm(root, { recursive: true, force: true }));

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
const KEY = "sk-test-secret-value-123";
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };

// Fake fetch: records each call and answers with MP3 bytes, or 500 for the text in failOn.
function fakeFetch(calls: Call[], failOn?: string): Fetch {
  return async (url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, method: String(init.method), headers: { ...(init.headers as Record<string, string>) }, body });
    if (failOn !== undefined && (body.text ?? body.input) === failOn) return new Response("boom", { status: 500 });
    return new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
  };
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { log: (l: string) => out.push(l), error: (l: string) => err.push(l) } };
}

let counter = 0;
async function lessonFile(steps: unknown[]) {
  const dir = join(root, `case-${counter++}`);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "lesson.json");
  await writeFile(file, JSON.stringify({ slug: "lesson-1", steps }));
  return { dir, file };
}

const STEPS = [
  { idx: 0, secret: { narration: "Variables hold values." } },
  { idx: 1, secret: {} }, // no narration
  { idx: 2, secret: { narration: "Loops repeat work." } },
];

const ELEVEN: Env = { ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: "voice-abc" };
const OPENAI: Env = { TTS_BASE_URL: "http://localhost:8880/", TTS_VOICE: "af_heart" };

test("provider selection: ElevenLabs when its key is set, else the OpenAI-compatible server, flag wins", () => {
  assert.equal(chooseProvider(undefined, ELEVEN), "elevenlabs");
  assert.equal(chooseProvider(undefined, OPENAI), "openai");
  assert.equal(chooseProvider(undefined, { ...ELEVEN, ...OPENAI }), "elevenlabs");
  assert.equal(chooseProvider("openai", { ...ELEVEN, ...OPENAI }), "openai");
  assert.equal(chooseProvider("elevenlabs", OPENAI), "elevenlabs");
  assert.throws(() => chooseProvider("azure", ELEVEN), /--provider must be elevenlabs or openai/);
  assert.throws(() => chooseProvider(undefined, {}), /No TTS provider configured/);
});

test("ElevenLabs request: POST to the voice URL with xi-api-key, Accept and { text, model_id }", () => {
  const req = ttsRequest(providerConfig("elevenlabs", ELEVEN), "Hi there");
  assert.equal(req.url, "https://api.elevenlabs.io/v1/text-to-speech/voice-abc");
  assert.equal(req.init.method, "POST");
  assert.deepEqual(req.init.headers, { "xi-api-key": KEY, Accept: "audio/mpeg", "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(String(req.init.body)), { text: "Hi there", model_id: "eleven_multilingual_v2" });

  const custom = ttsRequest(providerConfig("elevenlabs", { ...ELEVEN, ELEVENLABS_MODEL_ID: "eleven_turbo_v2" }), "x");
  assert.equal(JSON.parse(String(custom.init.body)).model_id, "eleven_turbo_v2");
});

test("OpenAI-compatible request: POST {base}/v1/audio/speech with { model, voice, input, response_format } and no key", () => {
  const req = ttsRequest(providerConfig("openai", OPENAI), "Hi there");
  assert.equal(req.url, "http://localhost:8880/v1/audio/speech");
  assert.equal(req.init.method, "POST");
  assert.deepEqual(req.init.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(String(req.init.body)), { model: "tts-1", voice: "af_heart", input: "Hi there", response_format: "mp3" });
});

test("missing config fails with a message that names variables, never values, and makes no request", async () => {
  const calls: Call[] = [];
  const { dir, file } = await lessonFile(STEPS);
  const cap = io();
  const code = await run(["--lesson-file", file, "--out", dir, "--provider", "elevenlabs"], { ELEVENLABS_API_KEY: KEY }, fakeFetch(calls), cap.io);
  assert.equal(code, 1);
  assert.match(cap.err.join("\n"), /needs ELEVENLABS_VOICE_ID set/);
  assert.ok(!cap.err.join("\n").includes(KEY));
  assert.equal(calls.length, 0);

  const none = io();
  assert.equal(await run(["--lesson-file", file, "--out", dir], {}, fakeFetch(calls), none.io), 1);
  assert.match(none.err.join("\n"), /No TTS provider configured/);

  const openaiNoVoice = io();
  assert.equal(await run(["--lesson-file", file, "--out", dir], { TTS_BASE_URL: "http://x" }, fakeFetch(calls), openaiNoVoice.io), 1);
  assert.match(openaiNoVoice.err.join("\n"), /needs TTS_VOICE set/);
  assert.equal(calls.length, 0);
});

test("usage: --out is required and --lesson or --lesson-file is required", async () => {
  const cap = io();
  assert.equal(await run(["--lesson", "x"], ELEVEN, fakeFetch([]), cap.io), 2);
  assert.match(cap.err.join("\n"), /--out <dir> is required/);
  const cap2 = io();
  assert.equal(await run(["--out", "/tmp/unused"], ELEVEN, fakeFetch([]), cap2.io), 2);
  assert.match(cap2.err.join("\n"), /--lesson <slug> or --lesson-file/);
  const cap3 = io();
  assert.equal(await run(["--out", "/tmp/unused", "--lesson", "x", "--bogus"], ELEVEN, fakeFetch([]), cap3.io), 2);
});

test("renders <idx>.mp3 per step with narration, reports steps without it, writes narration.json", async () => {
  const calls: Call[] = [];
  const { dir, file } = await lessonFile(STEPS);
  const out = join(dir, "out");
  const cap = io();
  const code = await run(["--lesson-file", file, "--out", out], ELEVEN, fakeFetch(calls), cap.io);

  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => [c.url, c.body.text]), [
    ["https://api.elevenlabs.io/v1/text-to-speech/voice-abc", "Variables hold values."],
    ["https://api.elevenlabs.io/v1/text-to-speech/voice-abc", "Loops repeat work."],
  ]);
  assert.equal(cap.out.length, 1);
  assert.match(cap.out[0]!, /^elevenlabs: rendered 2, skipped 0 unchanged, failed 0, no narration 1 -> /);
  assert.deepEqual(await readFile(join(out, "0.mp3")), Buffer.from(MP3));
  assert.deepEqual(await readFile(join(out, "2.mp3")), Buffer.from(MP3));
  await assert.rejects(access(join(out, "1.mp3")), "a step without narration gets no file");
  const manifest = JSON.parse(await readFile(join(out, "narration.json"), "utf8"));
  assert.deepEqual(manifest, { "0": hash("Variables hold values."), "2": hash("Loops repeat work.") });
});

test("rerun renders only steps whose text hash changed", async () => {
  const { dir, file } = await lessonFile(STEPS);
  const out = join(dir, "out");
  await run(["--lesson-file", file, "--out", out], ELEVEN, fakeFetch([]), io().io);

  const calls: Call[] = [];
  const cap = io();
  assert.equal(await run(["--lesson-file", file, "--out", out], ELEVEN, fakeFetch(calls), cap.io), 0);
  assert.equal(calls.length, 0, "nothing changed, nothing rendered");
  assert.match(cap.out[0]!, /rendered 0, skipped 2 unchanged/);

  await writeFile(file, JSON.stringify({ steps: [STEPS[0], STEPS[1], { idx: 2, secret: { narration: "Loops repeat work, faster." } }] }));
  const calls2: Call[] = [];
  await run(["--lesson-file", file, "--out", out], ELEVEN, fakeFetch(calls2), io().io);
  assert.deepEqual(calls2.map((c) => c.body.text), ["Loops repeat work, faster."]);
});

test("a rerun renders a step again when its mp3 is missing, even if the hash matches", async () => {
  const { dir, file } = await lessonFile(STEPS);
  const out = join(dir, "out");
  await run(["--lesson-file", file, "--out", out], ELEVEN, fakeFetch([]), io().io);
  await rm(join(out, "0.mp3"));
  const calls: Call[] = [];
  await run(["--lesson-file", file, "--out", out], ELEVEN, fakeFetch(calls), io().io);
  assert.deepEqual(calls.map((c) => c.body.text), ["Variables hold values."]);
});

test("a failed step is reported, the others still render, and it is retried next run", async () => {
  const { dir, file } = await lessonFile(STEPS);
  const out = join(dir, "out");
  const cap = io();
  const code = await run(["--lesson-file", file, "--out", out], ELEVEN, fakeFetch([], "Loops repeat work."), cap.io);
  assert.equal(code, 1);
  assert.match(cap.err.join("\n"), /step 2: provider returned HTTP 500/);
  assert.ok(!cap.err.join("\n").includes(KEY));
  assert.match(cap.out[0]!, /rendered 1, skipped 0 unchanged, failed 1, no narration 1/);
  await access(join(out, "0.mp3"));
  await assert.rejects(access(join(out, "2.mp3")));
  assert.deepEqual(JSON.parse(await readFile(join(out, "narration.json"), "utf8")), { "0": hash("Variables hold values.") });

  const calls: Call[] = [];
  assert.equal(await run(["--lesson-file", file, "--out", out], ELEVEN, fakeFetch(calls), io().io), 0);
  assert.deepEqual(calls.map((c) => c.body.text), ["Loops repeat work."]);
});

test("a step whose narration was removed loses its old mp3", async () => {
  const { dir, file } = await lessonFile(STEPS);
  const out = join(dir, "out");
  await run(["--lesson-file", file, "--out", out], ELEVEN, fakeFetch([]), io().io);
  await writeFile(file, JSON.stringify({ steps: [{ idx: 0, secret: {} }, STEPS[1], STEPS[2]] }));
  await run(["--lesson-file", file, "--out", out], ELEVEN, fakeFetch([]), io().io);
  await assert.rejects(access(join(out, "0.mp3")), "stale audio for removed text is deleted");
});

test("the openai provider renders through the local server with the same file layout", async () => {
  const calls: Call[] = [];
  const { dir, file } = await lessonFile(STEPS);
  const out = join(dir, "out");
  const code = await run(["--lesson-file", file, "--out", out], OPENAI, fakeFetch(calls), io().io);
  assert.equal(code, 0);
  assert.equal(calls[0]!.url, "http://localhost:8880/v1/audio/speech");
  assert.deepEqual(calls[0]!.body, { model: "tts-1", voice: "af_heart", input: "Variables hold values.", response_format: "mp3" });
  await access(join(out, "0.mp3"));
  await access(join(out, "2.mp3"));
});
