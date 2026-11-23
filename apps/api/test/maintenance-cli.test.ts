import "./helpers.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { lessonMedia, lessons } from "../src/db/schema.ts";
import { seed } from "../src/db/seed.ts";
import { s3Storage } from "../src/media/storage.ts";

const execute = promisify(execFile);

function run(entry: string, args: string[], overrides: NodeJS.ProcessEnv) {
  return execute(process.execPath, [entry, ...args], {
    env: { ...process.env, ...overrides },
    timeout: 15_000,
  });
}

test("the migration CLI requires a connection string and supports the unpooled database URL", async () => {
  const entry = "src/db/migrate-cli.ts";
  await assert.rejects(run(entry, [], { DATABASE_URL: undefined, DATABASE_URL_UNPOOLED: undefined }), {
    code: 1,
    stderr: /DATABASE_URL .* is required to run migrations/,
  });

  await run(entry, [], { DATABASE_URL: "invalid", DATABASE_URL_UNPOOLED: process.env.DATABASE_URL });
  await run(entry, [], { DATABASE_URL_UNPOOLED: undefined });
  assert.deepEqual(await db.select({ slug: lessons.slug }).from(lessons), []);
});

test("the narration CLI reads numbered MP3s, skips existing media and reports invalid input", async (t) => {
  await seed();
  const dir = await mkdtemp(join(tmpdir(), "learnslop-narration-"));
  t.after(() => rm(dir, { recursive: true }));
  const audio = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  await writeFile(join(dir, "0.mp3"), audio);
  await writeFile(join(dir, "notes.mp3"), "ignored");

  const uploads: Array<{ url: string | undefined; body: Buffer }> = [];
  const server = createServer((req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "audio/mpeg" }).end(audio);
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (req.method !== "PUT") {
        res.writeHead(405).end();
        return;
      }
      uploads.push({ url: req.url, body: Buffer.concat(chunks) });
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const overrides = {
    S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
    S3_BUCKET: "narration",
    S3_ACCESS_KEY_ID: "local-test",
    S3_SECRET_ACCESS_KEY: "local-test",
  };
  const narrate = (...args: string[]) => run("src/media/import-narration.ts", args, overrides);

  await assert.rejects(narrate(), { code: 1, stderr: /usage: pnpm media:narration/ });
  await assert.rejects(narrate("--lesson", "missing", "--dir", dir), { code: 1, stderr: /Lesson missing not found/ });
  assert.equal(uploads.length, 0);

  const args = ["--lesson", "lesson-1", "--dir", dir];
  assert.match((await narrate(...args)).stdout, /saved steps \[0\], skipped \(already stored\) \[\]/);
  assert.match((await narrate(...args)).stdout, /saved steps \[\], skipped \(already stored\) \[0\]/);
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].body, audio);
  const [lesson] = await db.select().from(lessons).where(eq(lessons.slug, "lesson-1"));
  const [row] = await db.select().from(lessonMedia).where(and(
    eq(lessonMedia.lessonVersionId, lesson.currentVersionId!),
    eq(lessonMedia.kind, "narration"),
    eq(lessonMedia.status, "ready"),
  ));
  assert.ok(row?.key);
  assert.equal(new URL(uploads[0].url!, overrides.S3_ENDPOINT).pathname, `/narration/${row.key}`);
  const storage = s3Storage({
    endpoint: overrides.S3_ENDPOINT,
    bucket: overrides.S3_BUCKET,
    accessKeyId: overrides.S3_ACCESS_KEY_ID,
    secretAccessKey: overrides.S3_SECRET_ACCESS_KEY,
    region: "auto",
  });
  const downloaded = await storage.get(row.key, AbortSignal.timeout(2_000));
  assert.ok(downloaded);
  assert.deepEqual(Buffer.from(downloaded), audio);
});
