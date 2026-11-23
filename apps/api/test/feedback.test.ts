import { deepEqual, equal, match, ok } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { signUp, trpc } from "./helpers.ts";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { feedbackReports } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { memoryStorage, setStorage } from "../src/media/storage.ts";

const app = buildApp();
const form = { name: "Private handle", email: "private@example.test", details: "Private report details" };
const submit = (payload: object, remoteAddress = "192.0.2.1") =>
  app.inject({ method: "POST", url: "/api/feedback", remoteAddress, payload });

beforeEach(async () => {
  env.POSTHOG_PROJECT_TOKEN = undefined;
  env.POSTHOG_HOST = undefined;
  await db.delete(feedbackReports);
});
after(async () => {
  setStorage(null);
  await app.close();
});

test("signed-out reports accept all categories and reject invalid email, fields and attachments", async () => {
  const id = randomUUID();
  const general = { ...form, id, category: "general" };
  const feature = { ...form, id: randomUUID(), category: "feature" };
  const bug = { ...form, id: randomUUID(), category: "bug", location: "Editor" };
  equal((await submit({ ...general, email: "bad address" })).statusCode, 400);
  equal((await submit({ ...feature, screenshot: "AA==" })).statusCode, 400);
  equal((await submit({ ...bug, location: "  " })).statusCode, 400);
  equal((await submit(general)).statusCode, 201);
  equal((await submit(general)).statusCode, 200);
  equal((await submit({ ...general, details: "Changed" })).statusCode, 409);
  equal((await submit(feature)).statusCode, 201);
  equal((await submit(bug)).statusCode, 201);
  equal((await submit({ ...bug, id: randomUUID(), screenshot: "AA==" })).statusCode, 503);
  equal((await submit({ ...bug, id: randomUUID(), screenshot: "A".repeat(3 * 1024 * 1024) })).statusCode, 413);
  equal((await db.select().from(feedbackReports)).length, 3);
});

test("screenshot retries keep one report, require admin access, and emit only a category and opaque ID", async (t) => {
  const cookie = await signUp(app, "feedback-admin@example.test");
  const asLearner = trpc(app, cookie);
  env.POSTHOG_PROJECT_TOKEN = "feedback-test-token";
  env.POSTHOG_HOST = "http://127.0.0.1:1";
  t.after(() => setStorage(null));

  const capture = t.mock.method(globalThis, "fetch", async (_url: URL, _init: RequestInit) => new Response("{}"));
  const image = await sharp({ create: { width: 48, height: 32, channels: 3, background: "blue" } })
    .png().withMetadata({ density: 200 }).toBuffer();
  const memory = memoryStorage();
  const id = randomUUID();
  const payload = { ...form, id, category: "bug", location: "Private location", screenshot: image.toString("base64") };
  const path = `/api/admin/feedback/${id}/screenshot`;

  setStorage({ ...memory, put: async () => { throw new Error("local bucket unavailable"); } });
  equal((await submit({ ...payload, screenshot: "not-base64" }, "192.0.2.2")).statusCode, 422);
  equal((await submit({ ...payload, screenshot: image.subarray(0, 12).toString("base64") }, "192.0.2.2")).statusCode, 422);
  equal((await submit(payload, "192.0.2.2")).statusCode, 503);
  equal(capture.mock.callCount(), 0);
  equal((await app.inject(path)).statusCode, 401);
  equal((await app.inject({ url: path, headers: { cookie } })).statusCode, 403);
  equal((await trpc(app).q("admin.feedback.get", id)).statusCode, 401);
  equal((await asLearner.q("admin.feedback.list", {})).statusCode, 403);
  await db.execute(sql`UPDATE learners SET is_admin = true`);
  equal((await asLearner.q("admin.feedback.get", id)).statusCode, 404);
  equal((await app.inject({ url: path, headers: { cookie } })).statusCode, 404);

  setStorage(memory);
  const responses = await Promise.all([submit(payload, "192.0.2.2"), submit(payload, "192.0.2.2")]);
  deepEqual(responses.map((res) => res.statusCode).sort(), [200, 201]);
  for (const res of responses) deepEqual(res.json(), { id });
  equal(capture.mock.callCount(), 1);
  const [url, init] = capture.mock.calls[0].arguments;
  ok(url instanceof URL);
  ok(typeof init?.body === "string");
  equal(url.href, "http://127.0.0.1:1/capture/");
  deepEqual(JSON.parse(init.body), {
    api_key: "feedback-test-token",
    event: "feedback_submitted",
    properties: { distinct_id: id, category: "bug", $process_person_profile: false, $geoip_disable: true },
  });

  const list = await asLearner.q("admin.feedback.list", {});
  equal(list.statusCode, 200);
  match(String(list.headers["cache-control"]), /no-store/);
  const [listed] = list.json().result.data.items;
  deepEqual(Object.keys(listed).sort(), ["category", "createdAt", "id"]);
  const response = await asLearner.q("admin.feedback.get", id);
  equal(response.statusCode, 200);
  deepEqual(response.json().result.data, { ...listed, ...form, location: payload.location, hasScreenshot: true });

  const screenshot = await app.inject({ url: path, headers: { cookie } });
  equal(screenshot.statusCode, 200);
  equal(screenshot.headers["content-type"], "image/webp");
  match(String(screenshot.headers["cache-control"]), /no-store/);
  const metadata = await sharp(screenshot.rawPayload).metadata();
  equal(metadata.format, "webp");
  equal(metadata.width, 48);
  equal(metadata.height, 32);
  equal(metadata.exif, undefined);
  equal(memory.objects.size, 1);

  await db.execute(sql`UPDATE learners SET is_admin = false`);
  equal((await app.inject({ url: path, headers: { cookie } })).statusCode, 403);
});

test("the inbox pages older reports with tied creation times", async () => {
  const cookie = await signUp(app, "pagination-admin@example.test");
  const list = (before?: string) => trpc(app, cookie).q("admin.feedback.list", { before });
  equal((await list()).statusCode, 403);
  await db.execute(sql`UPDATE learners SET is_admin = true`);
  const ids = Array.from({ length: 21 }, () => randomUUID()).sort().reverse();
  await db.insert(feedbackReports).values(ids.map((id) => ({
    ...form, id, category: "feature" as const, received: true, submissionHash: id,
  })));

  const firstPage = await list();
  equal(firstPage.statusCode, 200, firstPage.body);
  const first = firstPage.json().result.data;
  const secondPage = await list(first.next);
  equal(secondPage.statusCode, 200, secondPage.body);
  const second = secondPage.json().result.data;
  deepEqual(first.items.map((item: { id: string }) => item.id), ids.slice(0, 20));
  deepEqual(second.items.map((item: { id: string }) => item.id), ids.slice(20));
  ok(!second.next);
});
