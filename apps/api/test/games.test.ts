import { code, out, readSteps, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { gameAttempts, gameCompletions, lessons, lessonVersions, partCompletions, steps, user, worlds, type PartSecret } from "../src/db/schema.ts";
import { toPublicGame, type GameProps } from "@learnquest/ui-catalog";

const app = buildApp();
after(() => app.close());

const m = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).m(path, input);
const q = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).q(path, input);

const shell = { goalText: "Win.", alt: "A game used in tests.", shell: {} };
const game = (id: string, title: string, hints: string[], kind: unknown) => ({ type: "game", id, props: { title, ...shell, hints, kind } });

const blocks = [
  game("quiz", "Quiz", ["quiz hint 1", "quiz hint 2"], { kind: "quiz", questions: [{ prompt: "2 + 2?", options: ["3", "4"], answer: 1 }, { prompt: "Pick c", options: ["a", "b", "c"], answer: 2 }] }),
  game("grid", "Grid", ["grid hint"], {
    kind: "grid", size: { w: 4, h: 3 }, start: { x: 0, y: 0, dir: "right" }, goal: { x: 3, y: 2 }, walls: [{ x: 1, y: 1 }], gems: [{ x: 3, y: 0 }],
    commands: ["forward", "left", "right", "pick"], mode: "solve", maxSteps: 12, solution: ["forward", "forward", "forward", "pick", "right", "forward", "forward"],
  }),
  game("order", "Order", [], { kind: "order", items: ["first", "second", "third", "fourth"] }),
  game("match", "Match", [], { kind: "match", pairs: [{ left: "cat", right: "meows" }, { left: "dog", right: "barks" }, { left: "cow", right: "moos" }] }),
  game("sort", "Sort", [], { kind: "sort", buckets: ["Plants", "Animals"], cards: [{ text: "oak", bucket: 0 }, { text: "fern", bucket: 0 }, { text: "fox", bucket: 1 }, { text: "owl", bucket: 1 }] }),
  game("physics", "Physics", [], { kind: "physics", target: { x: 20, width: 4 }, maxSpeed: 20 }),
];
const part: PartSecret = { kind: "game-practice", intro: "Play.", doc: { v: 1, blocks } as never };

async function addGame(slug: string, content: PartSecret = part, worldId?: string) {
  const world = worldId ?? (await db.select().from(worlds).where(eq(worlds.slug, "codequest")))[0]!.id;
  const [lesson] = await db.insert(lessons).values({ slug, title: slug, worldId: world, sourceKind: "authored", kind: "game-practice", status: "published" }).returning();
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1, content }).returning();
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
}

const keys = (o: object) => Object.keys(o).sort();
const SHELL_KEYS = ["alt", "gameIndex", "goalText", "hintCount", "kind", "shell", "title"];

test("lessons.get sends each game kind as an exact allowlist of keys", async () => {
  const cookie = await signUp(app);
  await addGame("games-1");
  const res = await q(cookie, "lessons.get", { id: "games-1" });
  assert.equal(res.statusCode, 200);
  const doc = out(res).part.doc as { blocks: { id: string; props: Record<string, any> }[] };
  assert.equal(doc.blocks.length, 6);
  const by = Object.fromEntries(doc.blocks.map((b) => [b.id, b.props]));

  for (const b of doc.blocks) assert.deepEqual(keys(b.props), SHELL_KEYS, b.id);
  assert.deepEqual(doc.blocks.map((b) => b.props.gameIndex), [0, 1, 2, 3, 4, 5]);
  assert.equal(by.quiz.hintCount, 2);
  assert.equal(by.order.hintCount, 0);

  assert.deepEqual(keys(by.quiz.kind), ["kind", "questions"]);
  assert.deepEqual(by.quiz.kind.questions.map((x: object) => keys(x)), [["options", "prompt"], ["options", "prompt"]]);
  assert.deepEqual(keys(by.grid.kind), ["commands", "gems", "goal", "kind", "maxSteps", "mode", "size", "start", "walls"]);
  assert.deepEqual(keys(by.order.kind), ["items", "kind"]);
  assert.deepEqual(keys(by.match.kind), ["kind", "lefts", "rights"]);
  assert.deepEqual(keys(by.sort.kind), ["buckets", "cards", "kind"]);
  assert.deepEqual(keys(by.physics.kind), ["kind", "maxSpeed", "target"]);

  assert.deepEqual([...by.order.kind.items].sort(), ["first", "fourth", "second", "third"]);
  assert.notDeepEqual(by.order.kind.items, ["first", "second", "third", "fourth"], "never the right order");
  assert.deepEqual([...by.match.kind.lefts].sort(), ["cat", "cow", "dog"]);
  assert.deepEqual([...by.sort.kind.cards].sort(), ["fern", "fox", "oak", "owl"]);

  const raw = res.body;
  for (const secret of ["hint 1", "hint 2", "grid hint", "\"answer\"", "\"solution\"", "\"pairs\"", "\"bucket\""]) assert.ok(!raw.includes(secret), secret);
});

test("lessons.get strips quiz answers and hints from game blocks in a learn doc", async () => {
  const cookie = await signUp(app);
  const world = (await db.select().from(worlds).where(eq(worlds.slug, "codequest")))[0]!.id;
  const learn: PartSecret = {
    kind: "learn",
    body: "Read this first.",
    doc: { v: 1, blocks: [game("learn-quiz", "Learn quiz", ["learn hint secret"], { kind: "quiz", questions: [{ prompt: "Which is 3?", options: ["x", "y", "z"], answer: 2 }] })] } as never,
  };
  const [lesson] = await db.insert(lessons).values({ slug: "learn-1", title: "learn-1", worldId: world, sourceKind: "authored", kind: "learn", status: "published" }).returning();
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1, content: learn }).returning();
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
  const checks = await db.insert(steps).values(readSteps.map((s, idx) => ({
    lessonVersionId: version!.id, idx,
    public: { title: s.title, prompt: s.prompt, kind: s.kind, options: s.options },
    secret: { beforeFiles: s.beforeFiles, hunks: s.hunks, answer: s.answer, hints: s.hints, explanations: s.explanations, concepts: s.concepts },
  }))).returning();
  out(await m(cookie, "steps.attempt", { id: checks[0]!.id, answer: { kind: "mcq", choice: 0 } }));

  const res = await q(cookie, "lessons.get", { id: "learn-1" });
  assert.equal(res.statusCode, 200);
  const doc = out(res).part.doc as { blocks: { id: string; props: Record<string, any> }[] };
  const props = doc.blocks[0]!.props;
  assert.equal(props.hintCount, 1);
  assert.ok(!("hints" in props), "no hints array");
  assert.deepEqual(keys(props.kind), ["kind", "questions"]);
  assert.deepEqual(props.kind.questions.map((x: object) => keys(x)), [["options", "prompt"]]);
  assert.equal(props.kind.questions[0].prompt, "Which is 3?");
  assert.deepEqual(props.kind.questions[0].options, ["x", "y", "z"]);

  const raw = res.body;
  for (const secret of ["learn hint secret", "\"answer\"", "\"hints\""]) assert.ok(!raw.includes(secret), secret);
});

test("watch mode sends per-step frames and never the solution, debug mode its starter, and nothing else extra", () => {
  const base = { title: "T", goalText: "G", alt: "A", hints: ["h"], shell: { lives: 2 } };
  const grid = { kind: "grid", size: { w: 3, h: 1 }, start: { x: 0, y: 0, dir: "right" }, goal: { x: 2, y: 0 }, walls: [], gems: [], commands: ["forward"], maxSteps: 5, solution: ["forward", "forward"] };
  const watch = toPublicGame({ ...base, kind: { ...grid, mode: "watch" } } as unknown as GameProps, 3);
  assert.deepEqual(keys(watch.kind), ["commands", "frames", "gems", "goal", "kind", "maxSteps", "mode", "size", "start", "walls"]);
  assert.deepEqual(watch.kind.kind === "grid" && watch.kind.frames, [
    { x: 1, y: 0, dir: "right", collected: [] },
    { x: 2, y: 0, dir: "right", collected: [] },
  ]);
  assert.deepEqual(watch.shell, { lives: 2 });
  assert.equal(watch.gameIndex, 3);
  const debug = toPublicGame({ ...base, kind: { ...grid, mode: "debug", starter: ["forward"] } } as unknown as GameProps, 0);
  assert.deepEqual(keys(debug.kind), ["commands", "gems", "goal", "kind", "maxSteps", "mode", "size", "start", "starter", "walls"]);
  const extra = toPublicGame({ ...base, secret: "x", kind: { kind: "order", items: ["a", "b"], leak: 1 } } as unknown as GameProps, 0);
  assert.deepEqual(keys(extra), SHELL_KEYS);
  assert.deepEqual(keys(extra.kind), ["items", "kind"]);
});

const versionOf = async (lessonId: string) => (await db.select().from(lessons).where(eq(lessons.slug, lessonId)))[0]?.currentVersionId ?? "00000000-0000-4000-8000-000000000000";
const check = async (cookie: string, gameIndex: number, submission: unknown, lessonId = "games-1") => m(cookie, "games.check", { lessonId, versionId: await versionOf(lessonId), gameIndex, submission });

test("games.check grades every kind on the server", async () => {
  const cookie = await signUp(app);
  await addGame("games-1");
  const verdict = async (i: number, s: unknown) => out(await check(cookie, i, s));

  assert.deepEqual(await verdict(0, { kind: "quiz", answers: [1] }), { correct: false, complete: false, questionCorrect: true, remainingAttempts: 3 });
  assert.deepEqual(await verdict(0, { kind: "quiz", answers: [0] }), { correct: false, complete: false, questionCorrect: false, remainingAttempts: 2 });
  assert.deepEqual(await verdict(0, { kind: "quiz", answers: [1, 0] }), { correct: false, complete: false, questionCorrect: false, remainingAttempts: 1 });
  assert.deepEqual(await verdict(0, { kind: "quiz", answers: [1, 2] }), { correct: true, complete: true, questionCorrect: true, remainingAttempts: 1 });
  assert.equal((await check(cookie, 0, { kind: "quiz", answers: [1, 2, 0] })).statusCode, 400, "more answers than questions");

  const good = ["forward", "forward", "forward", "pick", "right", "forward", "forward"];
  assert.equal((await verdict(1, { kind: "grid", program: good })).complete, true);
  assert.equal((await verdict(1, { kind: "grid", program: ["forward"] })).correct, false);
  assert.equal((await verdict(1, { kind: "grid", program: [{ repeat: 3, body: ["forward"] }, "pick", "right", { repeat: 2, body: ["forward"] }] })).correct, false, "repeat is not allowed in this puzzle");

  assert.equal((await verdict(2, { kind: "order", order: ["first", "second", "third", "fourth"] })).complete, true);
  assert.equal((await verdict(2, { kind: "order", order: ["second", "first", "third", "fourth"] })).correct, false);
  assert.equal((await verdict(2, { kind: "order", order: ["first", "second"] })).correct, false);

  const pairs = [{ left: "cat", right: "meows" }, { left: "dog", right: "barks" }, { left: "cow", right: "moos" }];
  assert.equal((await verdict(3, { kind: "match", pairs: [...pairs].reverse() })).complete, true, "order of pairs does not matter");
  assert.equal((await verdict(3, { kind: "match", pairs: [{ left: "cat", right: "barks" }, { left: "dog", right: "meows" }, { left: "cow", right: "moos" }] })).correct, false);
  assert.equal((await verdict(3, { kind: "match", pairs: [pairs[0], pairs[0], pairs[2]] })).correct, false, "a repeated left is not a match");

  const cards = [{ text: "fox", bucket: 1 }, { text: "oak", bucket: 0 }, { text: "owl", bucket: 1 }, { text: "fern", bucket: 0 }];
  assert.equal((await verdict(4, { kind: "sort", cards })).complete, true);
  assert.equal((await verdict(4, { kind: "sort", cards: cards.map((c) => ({ ...c, bucket: 1 - c.bucket })) })).correct, false);
  assert.equal((await verdict(4, { kind: "sort", cards: cards.slice(1) })).correct, false);

  assert.equal((await verdict(5, { kind: "physics", angle: 45, speed: 14 })).complete, true);
  assert.equal((await verdict(5, { kind: "physics", angle: 45, speed: 5 })).correct, false);
  assert.equal((await check(cookie, 5, { kind: "physics", angle: 45, speed: 21 })).statusCode, 400, "above the speed slider");
  assert.equal((await check(cookie, 5, { kind: "physics", angle: 2, speed: 14 })).statusCode, 400, "below the angle slider");
});

test("games.check: a submission of the wrong kind is a 400, a missing game a 404", async () => {
  const cookie = await signUp(app);
  await addGame("games-1");
  const res = await check(cookie, 0, { kind: "order", order: ["a"] });
  assert.equal(res.statusCode, 400);
  assert.equal(code(res), "BAD_REQUEST");
  assert.equal((await check(cookie, 6, { kind: "quiz", answers: [1] })).statusCode, 404);
  assert.equal((await check(cookie, 0, { kind: "quiz", answers: [1] }, "nope")).statusCode, 404);
});

test("games.hint returns the stored hint, 404 out of range and for lessons the caller cannot see", async () => {
  const cookie = await signUp(app, "a@example.com");
  const other = await signUp(app, "b@example.com");
  await addGame("games-1");
  const hint = async (c: string, gameIndex: number, hintIndex: number, lessonId = "games-1") => m(c, "games.hint", { lessonId, versionId: await versionOf(lessonId), gameIndex, hintIndex });
  assert.equal(code(await hint(cookie, 0, 1)), "PRECONDITION_FAILED");
  assert.deepEqual(out(await hint(cookie, 0, 0)), { text: "quiz hint 1" });
  assert.deepEqual(out(await hint(cookie, 0, 0)), { text: "quiz hint 1" });
  assert.equal(code(await hint(other, 0, 1)), "PRECONDITION_FAILED");
  assert.deepEqual(out(await hint(cookie, 0, 1)), { text: "quiz hint 2" });
  for (const res of [await hint(cookie, 0, 2), await hint(cookie, 2, 0), await hint(cookie, 9, 0), await hint(cookie, 0, 0, "nope")]) {
    assert.equal(res.statusCode, 404);
    assert.equal(code(res), "NOT_FOUND");
  }

  const [priv] = await db
    .insert(worlds)
    .values({ slug: "b-course", title: "B", visibility: "private", ownerId: (await db.select({ id: user.id }).from(user).where(eq(user.email, "b@example.com")))[0]!.id, origin: "community" })
    .returning();
  await addGame("b-games", part, priv!.id);
  assert.equal((await hint(cookie, 0, 0, "b-games")).statusCode, 404, "private course of someone else");
  assert.equal((await check(cookie, 0, { kind: "quiz", answers: [1, 2] }, "b-games")).statusCode, 404);
  assert.deepEqual(out(await hint(other, 0, 0, "b-games")), { text: "quiz hint 1" });
});

test("wrong guesses spend a shared daily budget across concurrent requests for the same block", async () => {
  const cookie = await signUp(app);
  await addGame("games-1");
  const versionId = await versionOf("games-1");
  const status = async (gameIndex: number) => out(await q(cookie, "games.status", { lessonId: "games-1", gameIndex, versionId }));
  const guess = { kind: "quiz", answers: [0] };
  const misses = await Promise.all([0, 1, 2, 3].map(async () => out(await check(cookie, 0, guess))));
  assert.deepEqual(misses.map((res) => res.remainingAttempts).sort(), [0, 0, 1, 2]);
  assert.deepEqual(await status(0), { remainingAttempts: 0, maxAttempts: 3 });
  assert.deepEqual(await status(1), { remainingAttempts: 3, maxAttempts: 3 });
  const solution = { kind: "quiz", answers: [1, 2] };
  assert.deepEqual(out(await check(cookie, 0, solution)), { correct: false, complete: false, remainingAttempts: 0 });
  assert.equal((await db.select().from(gameCompletions)).length, 0);
  await db.update(gameAttempts).set({ attemptDay: "2000-01-01" }).where(eq(gameAttempts.lessonVersionId, versionId));
  assert.deepEqual(await status(0), { remainingAttempts: 3, maxAttempts: 3 });
  assert.equal(out(await check(cookie, 0, solution)).complete, true);
});

test("a win is recorded only when the server says the game is complete", async () => {
  const cookie = await signUp(app);
  await addGame("games-1");
  const count = async () => [(await db.select().from(gameCompletions)).length, (await db.select().from(partCompletions)).length];
  await check(cookie, 0, { kind: "quiz", answers: [1] });
  await check(cookie, 2, { kind: "order", order: ["second", "first", "third", "fourth"] });
  assert.deepEqual(await count(), [0, 0], "partial and wrong submissions record nothing");
  assert.equal((await m(cookie, "games.complete", { lessonId: "games-1", partIdx: 0, blockId: "quiz" })).statusCode, 404, "no client claim path");
  assert.deepEqual(await count(), [0, 0]);

  await check(cookie, 2, { kind: "order", order: ["first", "second", "third", "fourth"] });
  assert.deepEqual(await count(), [1, 0], "one win of six games does not complete the lesson");
  await check(cookie, 2, { kind: "order", order: ["first", "second", "third", "fourth"] });
  assert.deepEqual(await count(), [1, 0], "idempotent");
  const [row] = await db.select().from(gameCompletions);
  assert.equal(row!.blockId, "order");
});

test("a game lesson completes only when its last game block is won", async () => {
  const cookie = await signUp(app);
  const order = (id: string) => game(id, id, [], { kind: "order", items: ["first", "second"] });
  await addGame("games-two", { kind: "game-practice", intro: "Play.", doc: { v: 1, blocks: [order("o1"), order("o2")] } as never });
  const count = async () => (await db.select().from(partCompletions)).length;
  const win = (gameIndex: number) => check(cookie, gameIndex, { kind: "order", order: ["first", "second"] }, "games-two");

  assert.equal(out(await win(0)).complete, true);
  assert.equal(await count(), 0);
  assert.equal(out(await win(1)).complete, true);
  assert.equal(await count(), 1);
});

const watchGrid = { kind: "grid", size: { w: 3, h: 1 }, start: { x: 0, y: 0, dir: "right" }, goal: { x: 2, y: 0 }, walls: [], gems: [], commands: ["forward"], mode: "watch", maxSteps: 5, solution: ["forward", "forward"] };
const watchPart: PartSecret = { kind: "game-practice", intro: "Watch.", doc: { v: 1, blocks: [game("watch", "Watch", [], watchGrid)] } as never };

test("a watch game serves frames without the solution and completes only through completeWatch", async () => {
  const cookie = await signUp(app);
  await addGame("watch-1", watchPart);
  const res = await q(cookie, "lessons.get", { id: "watch-1" });
  const props = (out(res).part.doc as { blocks: { props: Record<string, any> }[] }).blocks[0]!.props;
  assert.deepEqual(keys(props.kind), ["commands", "frames", "gems", "goal", "kind", "maxSteps", "mode", "size", "start", "walls"]);
  assert.deepEqual(props.kind.frames.map((f: { x: number }) => f.x), [1, 2]);
  assert.ok(!res.body.includes("\"solution\""), "no solution key anywhere in the lesson");

  const versionId = await versionOf("watch-1");
  const generic = await m(cookie, "games.check", { lessonId: "watch-1", versionId, gameIndex: 0, submission: { kind: "grid", program: ["forward", "forward"] } });
  assert.equal(generic.statusCode, 400);
  assert.equal(code(generic), "BAD_REQUEST");

  const first = await m(cookie, "games.completeWatch", { lessonId: "watch-1", versionId, gameIndex: 0 });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(out(first), { correct: true, complete: true, remainingAttempts: 3 });
  assert.equal(out(await m(cookie, "games.completeWatch", { lessonId: "watch-1", versionId, gameIndex: 0 })).complete, true, "a repeat is accepted");
  assert.equal(out(await q(cookie, "lessons.get", { id: "watch-1" })).completed, true);
});

test("completeWatch refuses other game kinds and stale versions", async () => {
  const cookie = await signUp(app);
  await addGame("games-watch-guard");
  const versionId = await versionOf("games-watch-guard");
  const wrongMode = await m(cookie, "games.completeWatch", { lessonId: "games-watch-guard", versionId, gameIndex: 0 });
  assert.equal(wrongMode.statusCode, 400);
  assert.equal(code(wrongMode), "BAD_REQUEST");
  const stale = await m(cookie, "games.completeWatch", { lessonId: "games-watch-guard", versionId: "00000000-0000-4000-8000-000000000000", gameIndex: 1 });
  assert.equal(stale.statusCode, 409);
});
