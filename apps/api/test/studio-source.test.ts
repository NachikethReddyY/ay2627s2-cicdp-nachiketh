process.env.NODE_ENV = "production";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";

const { allowedSourceUrl, fetchSource, htmlToText, SourceError } = await import("../src/studio/source.ts");
const { pcmToWav, synthesize, TtsError } = await import("../src/studio/tts.ts");

const CFG = { apiKey: "k", model: "hexgrad/kokoro-82m", voice: "af_heart", sampleRate: 24_000 };

test("only https docs.python.org links are allowed as a source", () => {
  assert.ok(allowedSourceUrl("https://docs.python.org/3/tutorial/datastructures.html"));
  assert.equal(allowedSourceUrl("http://docs.python.org/3/tutorial/datastructures.html"), null);
  assert.equal(allowedSourceUrl("https://docs.python.org.evil.test/x"), null);
  assert.equal(allowedSourceUrl("https://evil.test/docs.python.org"), null);
  assert.equal(allowedSourceUrl("not a url"), null);
});

test("htmlToText drops markup and scripts, decodes entities, and starts at the section heading", () => {
  const html = "<nav>Menu</nav><script>var x = 1;</script><h1>5. Data Structures</h1><p>Use &lt;list&gt; &amp; &#39;tuple&#39;.</p>";
  assert.equal(htmlToText(html), "5. Data Structures Use <list> & 'tuple'.");
});

test("htmlToText keeps the whole text when there is no section heading", () => {
  assert.equal(htmlToText("<p>Lists   are\n mutable.</p>"), "Lists are mutable.");
});

test("fetchSource refuses a non-allowed link without fetching", async () => {
  await assert.rejects(
    fetchSource("https://example.com/x", async () => {
      throw new Error("must not fetch");
    }),
    SourceError,
  );
});

test("fetchSource returns the page text and does not follow redirects", async () => {
  let init: RequestInit | undefined;
  const text = await fetchSource(
    "https://docs.python.org/3/tutorial/datastructures.html",
    async (_url, reqInit) => {
      init = reqInit;
      return new Response("<h1>5. Data Structures</h1>", { status: 200 });
    },
  );
  assert.equal(text, "5. Data Structures");
  assert.equal(init?.redirect, "error");
});

test("fetchSource reports a page that answers with an error status", async () => {
  await assert.rejects(
    fetchSource("https://docs.python.org/3/x.html", async () => new Response("", { status: 404 })),
    /answered 404/,
  );
});

test("synthesize asks OpenRouter for pcm speech and returns it wrapped as a wav file", async () => {
  let url = "";
  let body: Record<string, unknown> = {};
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input);
    body = JSON.parse(String(init?.body));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer k");
    return new Response(new Uint8Array([1, 0, 2, 0]), { headers: { "content-type": "audio/pcm" } });
  }) as typeof fetch;
  const audio = await synthesize("a", CFG, fakeFetch);
  assert.equal(url, "https://openrouter.ai/api/v1/audio/speech");
  assert.deepEqual(body, { model: "hexgrad/kokoro-82m", input: "a", voice: "af_heart", response_format: "pcm" });
  assert.deepEqual(audio, pcmToWav(new Uint8Array([1, 0, 2, 0]), 24_000));
});

test("synthesize turns a rejected key, a non-pcm answer or empty audio into a TtsError", async () => {
  await assert.rejects(
    synthesize("a", CFG, (async () => new Response("", { status: 401 })) as typeof fetch),
    (e: unknown) => e instanceof TtsError && e.status === 502 && /answered 401/.test(e.message),
  );
  await assert.rejects(
    synthesize("a", CFG, (async () => Response.json({ error: "x" })) as typeof fetch),
    (e: unknown) => e instanceof TtsError && /no pcm/.test(e.message),
  );
  await assert.rejects(
    synthesize("a", CFG, (async () => new Response(new Uint8Array(), { headers: { "content-type": "audio/pcm" } })) as typeof fetch),
    (e: unknown) => e instanceof TtsError && /no pcm/.test(e.message),
  );
  await assert.rejects(
    synthesize("a", CFG, (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch),
    (e: unknown) => e instanceof TtsError && /could not be reached/.test(e.message),
  );
});


test("pcmToWav writes a 44-byte mono 16-bit header at the model's sample rate", () => {
  const wav = Buffer.from(pcmToWav(new Uint8Array([1, 0, 2, 0]), 24_000));
  assert.equal(wav.length, 48);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), 40);
  assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
  assert.deepEqual([wav.readUInt16LE(20), wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt32LE(28)], [1, 1, 24_000, 48_000]);
  assert.deepEqual([wav.readUInt16LE(32), wav.readUInt16LE(34)], [2, 16]);
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), 4);
  assert.deepEqual([...wav.subarray(44)], [1, 0, 2, 0]);
});
