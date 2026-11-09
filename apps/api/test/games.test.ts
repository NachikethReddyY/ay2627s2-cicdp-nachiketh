import { code, out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { gameCompletions, lessons, lessonVersions, partCompletions, user, worlds, type PartSecret } from "../src/db/schema.ts";
import { toPublicGame, type GameProps } from "@learnquest/ui-catalog";

const app = buildApp();
after(() => app.close());

const m = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).m(path, input);
const q = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).q(path, input);

const shell = { goalText: "Win.", alt: "A game used in tests.", shell: {} };
const game = (id: string, title: string, hints: string[], kind: unknown) => ({ type: "game", id, props: { title, ...shell, hints, kind } });

// Game 0..5 in this order: quiz, grid, order, match, sort, physics.
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

  // Nothing secret appears anywhere in the response.
  const raw = res.body;
  for (const secret of ["hint 1", "hint 2", "grid hint", "\"answer\"", "\"solution\"", "\"pairs\"", "\"bucket\""]) assert.ok(!raw.includes(secret), secret);
});

test("watch mode sends its solution, debug mode its starter, and nothing else extra", () => {
  const base = { title: "T", goalText: "G", alt: "A", hints: ["h"], shell: { lives: 2 } };
  const grid = { kind: "grid", size: { w: 3, h: 1 }, start: { x: 0, y: 0, dir: "right" }, goal: { x: 2, y: 0 }, walls: [], gems: [], commands: ["forward"], maxSteps: 5, solution: ["forward", "forward"] };
  const watch = toPublicGame({ ...base, kind: { ...grid, mode: "watch" } } as unknown as GameProps, 3);
  assert.deepEqual(keys(watch.kind), ["commands", "gems", "goal", "kind", "maxSteps", "mode", "size", "solution", "start", "walls"]);
  assert.deepEqual(watch.shell, { lives: 2 });
  assert.equal(watch.gameIndex, 3);
  const debug = toPublicGame({ ...base, kind: { ...grid, mode: "debug", starter: ["forward"] } } as unknown as GameProps, 0);
  assert.deepEqual(keys(debug.kind), ["commands", "gems", "goal", "kind", "maxSteps", "mode", "size", "start", "starter", "walls"]);
  // A field added to the stored game later is not sent unless the allowlist names it.
  const extra = toPublicGame({ ...base, secret: "x", kind: { kind: "order", items: ["a", "b"], leak: 1 } } as unknown as GameProps, 0);
  assert.deepEqual(keys(extra), SHELL_KEYS);
  assert.deepEqual(keys(extra.kind), ["items", "kind"]);
});

const check = (cookie: string, gameIndex: number, submission: unknown, lessonId = "games-1") => m(cookie, "games.check", { lessonId, gameIndex, submission });

test("games.check grades every kind on the server", async () => {
  const cookie = await signUp(app);
  await addGame("games-1");
  const verdict = async (i: number, s: unknown) => out(await check(cookie, i, s));

  // quiz: graded per question, won only when every question is answered and right
  assert.deepEqual(await verdict(0, { kind: "quiz", answers: [1] }), { correct: false, complete: false, questionResults: [true] });
  assert.deepEqual(await verdict(0, { kind: "quiz", answers: [0] }), { correct: false, complete: false, questionResults: [false] });
  assert.deepEqual(await verdict(0, { kind: "quiz", answers: [1, 0] }), { correct: false, complete: false, questionResults: [true, false] });
  assert.deepEqual(await verdict(0, { kind: "quiz", answers: [1, 2] }), { correct: true, complete: true, questionResults: [true, true] });
  assert.equal((await check(cookie, 0, { kind: "quiz", answers: [1, 2, 0] })).statusCode, 400, "more answers than questions");

  // grid: the stored simulator runs the submitted program
  const good = ["forward", "forward", "forward", "pick", "right", "forward", "forward"];
  assert.equal((await verdict(1, { kind: "grid", program: good })).complete, true);
  assert.equal((await verdict(1, { kind: "grid", program: ["forward"] })).correct, false);
  assert.equal((await verdict(1, { kind: "grid", program: [{ repeat: 3, body: ["forward"] }, "pick", "right", { repeat: 2, body: ["forward"] }] })).correct, false, "repeat is not allowed in this puzzle");

  // order
  assert.equal((await verdict(2, { kind: "order", order: ["first", "second", "third", "fourth"] })).complete, true);
  assert.equal((await verdict(2, { kind: "order", order: ["second", "first", "third", "fourth"] })).correct, false);
  assert.equal((await verdict(2, { kind: "order", order: ["first", "second"] })).correct, false);

  // match
  const pairs = [{ left: "cat", right: "meows" }, { left: "dog", right: "barks" }, { left: "cow", right: "moos" }];
  assert.equal((await verdict(3, { kind: "match", pairs: [...pairs].reverse() })).complete, true, "order of pairs does not matter");
  assert.equal((await verdict(3, { kind: "match", pairs: [{ left: "cat", right: "barks" }, { left: "dog", right: "meows" }, { left: "cow", right: "moos" }] })).correct, false);
  assert.equal((await verdict(3, { kind: "match", pairs: [pairs[0], pairs[0], pairs[2]] })).correct, false, "a repeated left is not a match");

  // sort
  const cards = [{ text: "fox", bucket: 1 }, { text: "oak", bucket: 0 }, { text: "owl", bucket: 1 }, { text: "fern", bucket: 0 }];
  assert.equal((await verdict(4, { kind: "sort", cards })).complete, true);
  assert.equal((await verdict(4, { kind: "sort", cards: cards.map((c) => ({ ...c, bucket: 1 - c.bucket })) })).correct, false);
  assert.equal((await verdict(4, { kind: "sort", cards: cards.slice(1) })).correct, false);

  // physics: 14 m/s at 45 degrees lands at 20 m
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
  const hint = (c: string, gameIndex: number, hintIndex: number, lessonId = "games-1") => q(c, "games.hint", { lessonId, gameIndex, hintIndex });
  assert.deepEqual(out(await hint(cookie, 0, 0)), { text: "quiz hint 1" });
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
  assert.deepEqual(await count(), [1, 1]);
  await check(cookie, 2, { kind: "order", order: ["first", "second", "third", "fourth"] });
  assert.deepEqual(await count(), [1, 1], "idempotent");
  const [row] = await db.select().from(gameCompletions);
  assert.equal(row!.blockId, "order");
});
