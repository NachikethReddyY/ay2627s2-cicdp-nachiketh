import { code, out, readSteps, signUp, trpc, withChecks } from "./helpers.ts";
import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { attempts, generationCache, learners, lessons, lessonVersions, partCompletions, spendLedger, steps, user, worlds } from "../src/db/schema.ts";
import { engineParts } from "../src/engine-client/parts.ts";
import { env } from "../src/env.ts";
import { setModerationClient } from "../src/safety/moderation.ts";

const app = buildApp();
const original = { engine: engineParts.lesson, killSwitch: env.AI_KILL_SWITCH, dailyBudget: env.AI_DAILY_BUDGET_USD };
after(() => app.close());
afterEach(() => {
  engineParts.lesson = original.engine;
  env.AI_KILL_SWITCH = original.killSwitch;
  env.AI_DAILY_BUDGET_USD = original.dailyBudget;
  setModerationClient(async () => ({ flagged: false, scores: {} }));
});

const learn = { kind: "learn", body: "A new lesson about values." } as const;
const watch = {
  kind: "watch" as const,
  beforeFiles: { "main.js": "let x = 1;\n" },
  hunks: [{ id: "h1", file: "main.js", oldStart: 1, lines: ["-let x = 1;", "+let x = 2;"] }],
};

async function setup(options: { kind?: "learn" | "watch"; visibility?: "private" | "public"; sourceKind?: "ai" | "authored" } = {}) {
  const api = trpc(app, await signUp(app));
  out(await api.q("home.get"));
  const [person] = await db.select().from(user).where(eq(user.email, "a@example.com"));
  const [learner] = await db.select().from(learners).where(eq(learners.userId, person.id));
  const [world] = await db.insert(worlds).values({ slug: "upgrade-course", title: "Course", visibility: options.visibility ?? "private", origin: "ai", ownerId: person.id }).returning();
  const [lesson] = await db.insert(lessons).values({
    worldId: world.id, slug: "upgrade-lesson", title: "Lesson", kind: options.kind ?? "learn", sourceKind: options.sourceKind ?? "ai", status: "published",
  }).returning();
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson.id, version: 1, content: lesson.kind === "learn" ? { ...learn, body: "The existing lesson." } : watch }).returning();
  await db.update(lessons).set({ currentVersionId: version.id }).where(eq(lessons.id, lesson.id));
  return { api, world, lesson, version, learner, get: () => api.q("lessons.get", { id: lesson.slug }), upgrade: (versionId = version.id) => api.m("lessons.upgradeReadChecks", { id: lesson.slug, versionId }) };
}

for (const kind of ["learn", "watch"] as const) {
  test(`an explicit ${kind} upgrade preserves earlier versions, attempts and completion`, async () => {
    let calls = 0;
    engineParts.lesson = async () => (calls++, withChecks(kind === "learn" ? learn : watch));
    const { get, upgrade, version, lesson, learner } = await setup({ kind });
    const first = readSteps[0];
    const [oldStep] = await db.insert(steps).values({
      lessonVersionId: version.id, idx: 0,
      public: { title: first.title, prompt: first.prompt, kind: first.kind, options: first.options },
      secret: first,
    }).returning();
    const [attempt] = await db.insert(attempts).values({ learnerId: learner.id, stepId: oldStep.id, kind: "mcq", observed: true, correct: true }).returning();
    const [completion] = await db.insert(partCompletions).values({ learnerId: learner.id, lessonId: lesson.id }).returning();

    const before = out(await get());
    assert.equal(before.canUpgradeReadChecks, true);
    assert.equal(before.versionId, version.id);
    assert.deepEqual(before.part, version.content);
    assert.equal(calls, 0);
    assert.deepEqual(out(await upgrade()), { ok: true });
    assert.equal(code(await upgrade()), "CONFLICT");
    assert.equal(calls, 1);
    const result = out(await get());
    assert.equal(result.canUpgradeReadChecks, false);
    assert.equal(result.completed, true);
    assert.equal(result.part.kind, kind);
    assert.deepEqual(result.steps.map((step: { idx: number }) => step.idx), [0, 1]);
    const versions = await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id));
    assert.deepEqual(versions.find((row) => row.id === version.id), version);
    const replacement = versions.find((row) => row.version === 2);
    assert.ok(replacement?.publishedAt);
    assert.equal(result.versionId, replacement.id);
    assert.deepEqual(out(await upgrade(replacement.id)), { ok: true });
    assert.equal(Object.hasOwn(replacement.content!, "steps"), false);
    assert.deepEqual(await db.select().from(attempts).where(eq(attempts.id, attempt.id)), [attempt]);
    assert.deepEqual(await db.select().from(partCompletions).where(eq(partCompletions.lessonId, lesson.id)), [completion]);
  });
}

test("the upgrade requires ownership of an AI lesson", async () => {
  let calls = 0;
  engineParts.lesson = async () => (calls++, withChecks(learn));
  const { get, upgrade, world, lesson, version } = await setup();
  const stranger = trpc(app, await signUp(app, "stranger@example.com"));
  const strangerUpgrade = () => stranger.m("lessons.upgradeReadChecks", { id: lesson.slug, versionId: version.id });
  assert.equal((await strangerUpgrade()).statusCode, 404);
  await db.update(worlds).set({ visibility: "public" }).where(eq(worlds.id, world.id));
  assert.equal(out(await get()).canUpgradeReadChecks, true);
  assert.equal(out(await stranger.q("lessons.get", { id: lesson.slug })).canUpgradeReadChecks, false);
  assert.equal((await strangerUpgrade()).statusCode, 404);
  await db.update(lessons).set({ sourceKind: "authored" }).where(eq(lessons.id, lesson.id));
  assert.equal(out(await get()).canUpgradeReadChecks, false);
  assert.equal((await upgrade()).statusCode, 404);
  assert.equal(calls, 0);
});

test("a public upgrade swaps versions only after the full replacement passes moderation", async () => {
  const { get, upgrade, lesson, version } = await setup({ visibility: "public" });
  engineParts.lesson = async () => withChecks(learn);
  setModerationClient(async () => ({ flagged: true, scores: {} }));
  assert.equal((await upgrade()).statusCode, 500);
  assert.equal(out(await get()).versionId, version.id);
  assert.deepEqual(await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id)), [version]);
  assert.equal((await db.select().from(generationCache)).length, 0);

  const moderationInputs: unknown[] = [];
  setModerationClient(async (content) => {
    moderationInputs.push(JSON.parse(content) as unknown);
    return { flagged: false, scores: {} };
  });
  assert.deepEqual(out(await upgrade()), { ok: true });
  assert.deepEqual(moderationInputs, [withChecks(learn)]);
  const current = out(await get());
  assert.notEqual(current.versionId, version.id);
  assert.equal(current.steps.length, 2);
  assert.equal(current.canUpgradeReadChecks, false);
});

test("an unavailable public moderator refuses even a valid private cache hit", async () => {
  let calls = 0;
  engineParts.lesson = async () => (calls++, withChecks(learn));
  const { get, upgrade, world, lesson, version } = await setup();
  assert.equal((await upgrade()).statusCode, 200);
  await db.update(lessons).set({ currentVersionId: version.id }).where(eq(lessons.id, lesson.id));
  await db.update(worlds).set({ visibility: "public" }).where(eq(worlds.id, world.id));
  setModerationClient(async () => { throw new Error("Moderator unavailable"); });

  assert.equal((await upgrade()).statusCode, 500);
  assert.equal(calls, 1);
  assert.equal(out(await get()).versionId, version.id);
  assert.equal((await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id))).length, 2);
});

test("a stale page cannot replace a newer legacy version or reserve spend", async () => {
  let calls = 0;
  engineParts.lesson = async () => (calls++, withChecks(learn));
  const { get, upgrade, lesson, version } = await setup();
  const shown = out(await get());
  assert.equal(shown.versionId, version.id);
  const [newer] = await db.insert(lessonVersions).values({ lessonId: lesson.id, version: 2, content: learn }).returning();
  await db.update(lessons).set({ currentVersionId: newer.id }).where(eq(lessons.id, lesson.id));
  const spentBefore = (await db.select().from(spendLedger)).length;

  const stale = await upgrade(shown.versionId as string);
  assert.equal(stale.statusCode, 409);
  assert.equal(code(stale), "CONFLICT");
  assert.equal(calls, 0);
  assert.equal((await db.select().from(spendLedger)).length, spentBefore);
  const current = out(await get());
  assert.equal(current.versionId, newer.id);
  assert.equal(current.canUpgradeReadChecks, true);
});

test("parallel upgrades share generation and write a single version", async () => {
  let calls = 0;
  engineParts.lesson = async () => (calls++, withChecks(learn));
  const { upgrade, lesson } = await setup();
  const spentBefore = (await db.select().from(spendLedger)).length;
  const results = await Promise.all([upgrade(), upgrade(), upgrade()]);
  assert.ok(results.some((result) => result.statusCode === 200));
  for (const result of results) {
    if (result.statusCode === 200) assert.deepEqual(out(result), { ok: true });
    else assert.equal(code(result), "CONFLICT");
  }
  assert.equal(calls, 1);
  assert.equal((await db.select().from(spendLedger)).length, spentBefore + 1);
  assert.equal((await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id))).length, 2);
});

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}

for (const change of ["version", "visibility", "owner"] as const) {
  test(`an in-flight upgrade refuses to replace a lesson after its ${change} changes`, { timeout: 5000 }, async () => {
    const { upgrade, world, lesson, version } = await setup();
    const started = gate();
    const release = gate();
    engineParts.lesson = async () => {
      started.open();
      await release.opened;
      return withChecks(learn);
    };
    const pending = upgrade();
    await started.opened;
    let expected = version.id;
    try {
      if (change === "version") {
        const [newer] = await db.insert(lessonVersions).values({ lessonId: lesson.id, version: 2, content: learn }).returning();
        await db.update(lessons).set({ currentVersionId: newer.id }).where(eq(lessons.id, lesson.id));
        expected = newer.id;
      } else if (change === "visibility") {
        await db.update(worlds).set({ visibility: "public" }).where(eq(worlds.id, world.id));
      } else {
        await db.update(worlds).set({ ownerId: null }).where(eq(worlds.id, world.id));
      }
    } finally {
      release.open();
    }
    assert.equal(code(await pending), change === "owner" ? "NOT_FOUND" : "CONFLICT");
    const [current] = await db.select().from(lessons).where(eq(lessons.id, lesson.id));
    assert.equal(current.currentVersionId, expected);
  });
}

test("the upgrade observes the kill switch, spend cap, content validation and moderation", async () => {
  let calls = 0;
  engineParts.lesson = async () => (calls++, withChecks(watch));
  const { upgrade, lesson, version } = await setup();
  env.AI_KILL_SWITCH = true;
  assert.equal(code(await upgrade()), "PRECONDITION_FAILED");
  env.AI_KILL_SWITCH = false;
  env.AI_DAILY_BUDGET_USD = 0.001;
  assert.equal(code(await upgrade()), "TOO_MANY_REQUESTS");
  assert.equal(calls, 0);
  env.AI_DAILY_BUDGET_USD = 0;
  assert.equal((await upgrade()).statusCode, 500);
  engineParts.lesson = async () => (calls++, withChecks(learn));
  setModerationClient(async () => ({ flagged: true, scores: {} }));
  assert.equal((await upgrade()).statusCode, 500);
  assert.equal(calls, 2);
  assert.deepEqual(await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id)), [version]);
  assert.equal((await db.select().from(generationCache)).length, 0);
});

test("the upgrade reuses valid cached checks and regenerates an obsolete cache entry", async () => {
  let calls = 0;
  engineParts.lesson = async () => (calls++, withChecks(learn));
  const { upgrade, lesson, version } = await setup();
  assert.equal((await upgrade()).statusCode, 200);
  await db.update(lessons).set({ currentVersionId: version.id }).where(eq(lessons.id, lesson.id));
  assert.equal((await upgrade()).statusCode, 200);
  assert.equal(calls, 1);

  await db.update(lessons).set({ currentVersionId: version.id }).where(eq(lessons.id, lesson.id));
  await db.update(generationCache).set({ content: learn });
  assert.equal((await upgrade()).statusCode, 200);
  assert.equal(calls, 2);
  await db.update(lessons).set({ currentVersionId: version.id }).where(eq(lessons.id, lesson.id));
  assert.equal((await upgrade()).statusCode, 200);
  assert.equal(calls, 2);
});
