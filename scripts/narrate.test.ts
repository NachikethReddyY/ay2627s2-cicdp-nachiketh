import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chooseProvider, providerConfig, run, ttsRequest, type Env, type Fetch, type RunOptions } from "./narrate.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_URL = pathToFileURL(join(repoRoot, "scripts", "narrate.ts")).href;

const root = await mkdtemp(join(tmpdir(), "narrate-test-"));
after(() => rm(root, { recursive: true, force: true }));

// ID3 tag, so the bytes pass the MP3 check.
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
const KEY = "sk-test-secret-value-123";
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const exists = (p: string) => access(p).then(() => true, () => false);

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

const ELEVEN: Env = { ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: "voice-abc" };
const OPENAI: Env = { TTS_BASE_URL: "http://localhost:8880/", TTS_VOICE: "af_heart" };

const STEPS = [
  { idx: 0, secret: { narration: "Variables hold values." } },
  { idx: 1, secret: {} }, // no narration
  { idx: 2, secret: { narration: "Loops repeat work." } },
];

type Case = { lessonsDir: string; narrationRoot: string; outDir: string; setSteps: (steps: unknown[]) => Promise<void> };

// A lesson folder and an output root under a fresh temp dir. The lesson slug is always lesson-1.
let counter = 0;
async function makeCase(steps: unknown[]): Promise<Case> {
  const dir = join(root, `case-${counter++}`);
  const lessonsDir = join(dir, "lessons");
  const narrationRoot = join(dir, "narration");
  await mkdir(lessonsDir, { recursive: true });
  const setSteps = (s: unknown[]) => writeFile(join(lessonsDir, "lesson-1.json"), JSON.stringify({ slug: "lesson-1", steps: s }));
  await setSteps(steps);
  return { lessonsDir, narrationRoot, outDir: join(narrationRoot, "lesson-1"), setSteps };
}

const layout = (c: Case, extra: RunOptions = {}): RunOptions => ({ lessonsDir: c.lessonsDir, narrationRoot: c.narrationRoot, ...extra });
const go = (c: Case, env: Env, fetchImpl: Fetch, cap: ReturnType<typeof io>, extra?: RunOptions) =>
  run(["--lesson", "lesson-1"], env, fetchImpl, cap.io, layout(c, extra));

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

test("a base URL with several trailing slashes gives exactly one /v1/audio/speech", () => {
  for (const base of ["http://localhost:8880", "http://localhost:8880/", "http://localhost:8880///"]) {
    const req = ttsRequest(providerConfig("openai", { TTS_BASE_URL: base, TTS_VOICE: "v" }), "x");
    assert.equal(req.url, "http://localhost:8880/v1/audio/speech", base);
  }
});

test("missing config fails with a message that names variables, never values, and makes no request", async () => {
  const c = await makeCase(STEPS);
  const calls: Call[] = [];
  const cap = io();
  assert.equal(await run(["--lesson", "lesson-1", "--provider", "elevenlabs"], { ELEVENLABS_API_KEY: KEY }, fakeFetch(calls), cap.io, layout(c)), 1);
  assert.match(cap.err.join("\n"), /needs ELEVENLABS_VOICE_ID set/);
  assert.ok(!cap.err.join("\n").includes(KEY));
  assert.equal(calls.length, 0);

  const none = io();
  assert.equal(await go(c, {}, fakeFetch(calls), none), 1);
  assert.match(none.err.join("\n"), /No TTS provider configured/);

  const openaiNoVoice = io();
  assert.equal(await go(c, { TTS_BASE_URL: "http://x" }, fakeFetch(calls), openaiNoVoice), 1);
  assert.match(openaiNoVoice.err.join("\n"), /needs TTS_VOICE set/);
  assert.equal(calls.length, 0);
});

test("usage: --lesson is required and must be a slug; the CLI takes no path flags", async () => {
  const c = await makeCase(STEPS);
  const cap = io();
  assert.equal(await run([], ELEVEN, fakeFetch([]), cap.io, layout(c)), 2);
  assert.match(cap.err.join("\n"), /--lesson <slug> is required/);

  for (const slug of ["../escape", "a/../b", "x/y", "Upper", "x y"]) {
    const capSlug = io();
    assert.equal(await run(["--lesson", slug], ELEVEN, fakeFetch([]), capSlug.io, layout(c)), 2, slug);
    assert.match(capSlug.err.join("\n"), /must be lowercase letters, digits and hyphens/, slug);
  }

  // --out and --lesson-file are gone: strict parsing refuses them.
  for (const flag of [["--out", "/tmp/x"], ["--lesson-file", "/etc/hosts"]]) {
    const capFlag = io();
    assert.equal(await run(["--lesson", "lesson-1", ...flag], ELEVEN, fakeFetch([]), capFlag.io, layout(c)), 2, flag[0]);
  }
});

test("the default output folder is .narration/<slug> under the repo, and it is gitignored", () => {
  const ignored = spawnSync("git", ["check-ignore", "-q", join(".narration", "lesson-1", "0.mp3")], { cwd: repoRoot });
  assert.equal(ignored.status, 0, ".narration/ must be gitignored");
});

test("renders <idx>.mp3 per step with narration, reports steps without it, writes narration.json", async () => {
  const c = await makeCase(STEPS);
  const calls: Call[] = [];
  const cap = io();
  assert.equal(await go(c, ELEVEN, fakeFetch(calls), cap), 0);

  assert.deepEqual(calls.map((call) => [call.url, call.body.text]), [
    ["https://api.elevenlabs.io/v1/text-to-speech/voice-abc", "Variables hold values."],
    ["https://api.elevenlabs.io/v1/text-to-speech/voice-abc", "Loops repeat work."],
  ]);
  assert.equal(cap.out.length, 1);
  assert.match(cap.out[0]!, /^elevenlabs: rendered 2, skipped 0 unchanged, failed 0, no narration 1 -> /);
  assert.deepEqual(await readFile(join(c.outDir, "0.mp3")), Buffer.from(MP3));
  assert.deepEqual(await readFile(join(c.outDir, "2.mp3")), Buffer.from(MP3));
  assert.equal(await exists(join(c.outDir, "1.mp3")), false, "a step without narration gets no file");
  const manifest = JSON.parse(await readFile(join(c.outDir, "narration.json"), "utf8"));
  assert.deepEqual(manifest, { "0": hash("Variables hold values."), "2": hash("Loops repeat work.") });
});

test("rerun renders only steps whose text hash changed", async () => {
  const c = await makeCase(STEPS);
  await go(c, ELEVEN, fakeFetch([]), io());

  const calls: Call[] = [];
  const cap = io();
  assert.equal(await go(c, ELEVEN, fakeFetch(calls), cap), 0);
  assert.equal(calls.length, 0, "nothing changed, nothing rendered");
  assert.match(cap.out[0]!, /rendered 0, skipped 2 unchanged/);

  await c.setSteps([STEPS[0], STEPS[1], { idx: 2, secret: { narration: "Loops repeat work, faster." } }]);
  const calls2: Call[] = [];
  await go(c, ELEVEN, fakeFetch(calls2), io());
  assert.deepEqual(calls2.map((call) => call.body.text), ["Loops repeat work, faster."]);
});

test("a rerun renders a step again when its mp3 is missing, even if the hash matches", async () => {
  const c = await makeCase(STEPS);
  await go(c, ELEVEN, fakeFetch([]), io());
  await rm(join(c.outDir, "0.mp3"));
  const calls: Call[] = [];
  await go(c, ELEVEN, fakeFetch(calls), io());
  assert.deepEqual(calls.map((call) => call.body.text), ["Variables hold values."]);
});

test("a failed step is reported, the others still render, and it is retried next run", async () => {
  const c = await makeCase(STEPS);
  const cap = io();
  assert.equal(await go(c, ELEVEN, fakeFetch([], "Loops repeat work."), cap), 1);
  assert.match(cap.err.join("\n"), /step 2: provider returned HTTP 500/);
  assert.ok(!cap.err.join("\n").includes(KEY));
  assert.match(cap.out[0]!, /rendered 1, skipped 0 unchanged, failed 1, no narration 1/);
  await access(join(c.outDir, "0.mp3"));
  assert.equal(await exists(join(c.outDir, "2.mp3")), false);
  assert.deepEqual(JSON.parse(await readFile(join(c.outDir, "narration.json"), "utf8")), { "0": hash("Variables hold values.") });

  const calls: Call[] = [];
  assert.equal(await go(c, ELEVEN, fakeFetch(calls), io()), 0);
  assert.deepEqual(calls.map((call) => call.body.text), ["Loops repeat work."]);
});

test("a step removed from the lesson loses its mp3 on rerun, file first then hash", async () => {
  const c = await makeCase(STEPS);
  await go(c, ELEVEN, fakeFetch([]), io());
  await c.setSteps([{ idx: 0, secret: {} }, STEPS[1], STEPS[2]]);
  await go(c, ELEVEN, fakeFetch([]), io());
  assert.equal(await exists(join(c.outDir, "0.mp3")), false, "stale audio for removed text is deleted");
  assert.equal(JSON.parse(await readFile(join(c.outDir, "narration.json"), "utf8"))["0"], undefined);

  // A step deleted from the lesson entirely is cleaned up too.
  await c.setSteps([STEPS[2]]);
  await go(c, ELEVEN, fakeFetch([]), io());
  assert.equal(await exists(join(c.outDir, "2.mp3")), true);
  assert.deepEqual((await readdir(c.outDir)).sort(), ["2.mp3", "narration.json"]);
});

test("the openai provider renders through the local server with the same file layout", async () => {
  const c = await makeCase(STEPS);
  const calls: Call[] = [];
  assert.equal(await go(c, OPENAI, fakeFetch(calls), io()), 0);
  assert.equal(calls[0]!.url, "http://localhost:8880/v1/audio/speech");
  assert.deepEqual(calls[0]!.body, { model: "tts-1", voice: "af_heart", input: "Variables hold values.", response_format: "mp3" });
  await access(join(c.outDir, "0.mp3"));
  await access(join(c.outDir, "2.mp3"));
});

test("the manifest on disk is current at every render, and no temp file is left behind", async () => {
  const c = await makeCase(STEPS);
  const manifestPath = join(c.outDir, "narration.json");
  await mkdir(c.outDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify({ "0": hash("Variables hold values."), "2": hash("old text") }));
  await writeFile(join(c.outDir, "2.mp3"), "stale");
  const seen: { idx: string; manifest: Record<string, string>; hadMp3: boolean }[] = [];
  const fetchImpl: Fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const idx = body.text === "Variables hold values." ? "0" : "2";
    seen.push({ idx, manifest: JSON.parse(await readFile(manifestPath, "utf8")), hadMp3: await exists(join(c.outDir, `${idx}.mp3`)) });
    return new Response(MP3, { status: 200 });
  };
  // Step 0 is in the manifest but has no mp3, so it renders. Step 2 changed text.
  await rm(join(c.outDir, "0.mp3"), { force: true });
  await go(c, ELEVEN, fetchImpl, io());

  // Before each render, the step's old audio is gone and its hash is no longer in the manifest.
  for (const s of seen) {
    assert.equal(s.hadMp3, false, `step ${s.idx}: old audio is removed before the render`);
    assert.equal(s.manifest[s.idx], undefined, `step ${s.idx}: old hash is removed before the render`);
  }
  // After step 0 finished, step 2's render sees step 0 in the manifest on disk.
  const step2 = seen.find((s) => s.idx === "2")!;
  assert.equal(step2.manifest["0"], hash("Variables hold values."));
  assert.deepEqual((await readdir(c.outDir)).sort(), ["0.mp3", "2.mp3", "narration.json"]);
});

test("a lock held by a live run makes a second run exit with a message; a finished run releases its own lock", async () => {
  const c = await makeCase(STEPS);
  await mkdir(c.outDir, { recursive: true });
  // This test process is alive, so it stands in for a run that is still writing.
  await writeFile(join(c.outDir, ".narration.lock"), String(process.pid));
  const calls: Call[] = [];
  const cap = io();
  assert.equal(await go(c, ELEVEN, fakeFetch(calls), cap), 1);
  assert.match(cap.err.join("\n"), /another narrate run is writing .* \(pid \d+\)/);
  assert.equal(calls.length, 0, "the second run renders nothing");
  assert.equal(await readFile(join(c.outDir, ".narration.lock"), "utf8"), String(process.pid), "a lock this run did not take is left alone");

  await rm(join(c.outDir, ".narration.lock"));
  assert.equal(await go(c, ELEVEN, fakeFetch([]), io()), 0);
  assert.equal(await exists(join(c.outDir, ".narration.lock")), false, "the lock is released after the run");
});

test("a lock left by a dead run is stale and is taken over", async () => {
  const c = await makeCase(STEPS);
  await mkdir(c.outDir, { recursive: true });
  // A pid that has exited: spawn a process, wait for it, and keep its pid.
  const gone = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(gone, "exit");
  await writeFile(join(c.outDir, ".narration.lock"), String(gone.pid));
  const calls: Call[] = [];
  assert.equal(await go(c, ELEVEN, fakeFetch(calls), io()), 0);
  assert.equal(calls.length, 2, "the run went ahead");
  assert.equal(await exists(join(c.outDir, ".narration.lock")), false);
});

test("a bad signature or an oversize response fails the step and is not cached", async () => {
  const c = await makeCase([{ idx: 0, secret: { narration: "Variables hold values." } }]);
  const notAudio: Fetch = async () => new Response(new TextEncoder().encode("<html>nope</html>"), { status: 200 });
  const cap = io();
  assert.equal(await go(c, ELEVEN, notAudio, cap), 1);
  assert.match(cap.err.join("\n"), /step 0: provider did not return MP3 audio/);
  assert.equal(await exists(join(c.outDir, "0.mp3")), false);
  assert.deepEqual(JSON.parse(await readFile(join(c.outDir, "narration.json"), "utf8")), {}, "the hash is not cached");

  const huge = new Uint8Array(10 * 1024 * 1024 + 1);
  huge.set(MP3, 0);
  const oversize: Fetch = async () => new Response(huge, { status: 200 });
  const cap2 = io();
  assert.equal(await go(c, ELEVEN, oversize, cap2), 1);
  assert.match(cap2.err.join("\n"), /over the 10485760 byte limit/);
  assert.equal(await exists(join(c.outDir, "0.mp3")), false);
  assert.deepEqual(JSON.parse(await readFile(join(c.outDir, "narration.json"), "utf8")), {}, "the hash is not cached");

  // The next run with a good response renders it, so the bad response was not cached as done.
  const calls: Call[] = [];
  assert.equal(await go(c, ELEVEN, fakeFetch(calls), io()), 0);
  assert.equal(calls.length, 1);
});

test("a hung provider fails that step after the timeout, and the next step still renders", { timeout: 20_000 }, async () => {
  const c = await makeCase(STEPS);
  const HANG = "Variables hold values.";
  // Honours the signal like fetch does: the request never answers, and aborting rejects it.
  const hung: Fetch = async (url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (body.text === HANG) {
      const signal = init.signal!;
      return new Promise<Response>((_, reject) => {
        // The timeout signal's timer is unref'd, so on Node 22 an otherwise idle loop would exit with this promise pending.
        // A ref'd timer keeps the loop alive until the abort, and is cleared then.
        const keepAlive = setTimeout(() => {}, 10_000);
        signal.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          reject(signal.reason);
        });
      });
    }
    return new Response(MP3, { status: 200 });
  };
  const cap = io();
  assert.equal(await go(c, ELEVEN, hung, cap, { timeoutMs: 50 }), 1);
  assert.match(cap.err.join("\n"), /step 0: .*timeout|step 0: .*abort/i);
  assert.equal(await exists(join(c.outDir, "0.mp3")), false);
  await access(join(c.outDir, "2.mp3"));
});

test("a hung response body also fails the step after the timeout", { timeout: 20_000 }, async () => {
  const c = await makeCase([{ idx: 0, secret: { narration: "Variables hold values." } }]);
  // Headers arrive, then the body never does until the signal aborts.
  const stalledBody: Fetch = async (_url, init) => {
    const signal = init.signal!;
    const res = {
      ok: true,
      status: 200,
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((_, reject) => {
          const keepAlive = setTimeout(() => {}, 10_000); // ref'd, as above: keeps Node 22 from exiting while the body hangs
          signal.addEventListener("abort", () => {
            clearTimeout(keepAlive);
            reject(signal.reason);
          });
        }),
    };
    return res as unknown as Response;
  };
  const cap = io();
  assert.equal(await go(c, ELEVEN, stalledBody, cap, { timeoutMs: 50 }), 1);
  assert.equal(cap.err.length, 1);
  assert.equal(await exists(join(c.outDir, "0.mp3")), false);
});

// A real child process, killed mid-render. The child calls run() with the same injected layout.
test("a run killed mid-render cannot leave stale audio that a rerun skips", { timeout: 30_000 }, async () => {
  const A = "Variables hold values.";
  const B = "Variables hold values, changed.";
  const C = "Loops repeat work.";
  const HANG = "Functions name a block of work.";
  let hangOn: string | undefined;
  const seen: string[] = [];
  let onHang: () => void = () => {};
  const hanging = new Promise<void>((resolve) => (onHang = resolve));
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", () => {
      const { input } = JSON.parse(raw) as { input: string };
      seen.push(input);
      if (input === hangOn) return onHang(); // never answered: the child is killed here
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(Buffer.concat([Buffer.from("ID3"), Buffer.from(input)]));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const env = { PATH: process.env.PATH ?? "", TTS_BASE_URL: `http://127.0.0.1:${port}`, TTS_VOICE: "v" };
  const c = await makeCase([]);
  let stderr = "";
  // Runs the real run() in a child with the default fetch. Only the layout is injected.
  const child = (): ReturnType<typeof spawn> => {
    const p = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const [url, lessonsDir, narrationRoot] = process.argv.slice(1); const { run } = await import(url); process.exitCode = await run(['--lesson', 'lesson-1'], process.env, (u, i) => fetch(u, i), { log: console.log, error: console.error }, { lessonsDir, narrationRoot });",
        MODULE_URL,
        c.lessonsDir,
        c.narrationRoot,
      ],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );
    p.stderr!.on("data", (d: Buffer) => (stderr += d));
    return p;
  };

  try {
    await c.setSteps([{ idx: 0, secret: { narration: A } }, { idx: 2, secret: { narration: C } }]);
    assert.equal((await once(child(), "exit"))[0], 0, stderr);

    // Run 2 changes step 0 and hangs on step 2. Step 0's new audio is written before the kill.
    hangOn = HANG;
    await c.setSteps([{ idx: 0, secret: { narration: B } }, { idx: 2, secret: { narration: HANG } }]);
    const killed = child();
    await hanging;
    killed.kill("SIGKILL");
    await once(killed, "exit");
    assert.ok((await readFile(join(c.outDir, "0.mp3"), "utf8")).includes(B), "the interrupted run has written the new step 0 audio");

    // Run 3 restores step 0's old text. It must render it, not skip the file left by run 2.
    hangOn = undefined;
    const before = seen.length;
    await c.setSteps([{ idx: 0, secret: { narration: A } }, { idx: 2, secret: { narration: HANG } }]);
    assert.equal((await once(child(), "exit"))[0], 0, stderr);
    assert.ok(seen.slice(before).includes(A), "step 0 is rendered again");
    assert.ok((await readFile(join(c.outDir, "0.mp3"), "utf8")).includes(A), "the final step 0 audio matches its text");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
