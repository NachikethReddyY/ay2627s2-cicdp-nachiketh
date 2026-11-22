import { out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { learners } from "../src/db/schema.ts";
import { resolveLearnerId } from "../src/auth/guards.ts";

const app = buildApp();
after(() => app.close());

test("home.get leaderboard carries handles only, never email-derived text", async () => {
  const cookie = await signUp(app, "zorblax.quuxington.2011@example.com");
  const res = await trpc(app, cookie).q("home.get");
  const body = out(res);
  assert.equal(body.leaderboard.rows.length, 1);
  assert.match(body.leaderboard.rows[0].handle, /^learner-[0-9a-f]{10}$/);
  assert.deepEqual(Object.keys(body.leaderboard.rows[0]).sort(), ["handle", "rank", "xp", "you"]);
  assert.equal("optedIn" in body.leaderboard, false);
  assert.doesNotMatch(JSON.stringify(body.leaderboard), /zorblax|quuxington|2011|example/i);
});

test("me.update ignores the removed opt-out flag", async () => {
  const cookie = await signUp(app, "optout@example.com");
  await trpc(app, cookie).m("me.update", { leaderboardOptIn: false });
  const [row] = await db.select({ optIn: learners.leaderboardOptIn }).from(learners);
  assert.equal(row!.optIn, true);
  const body = out(await trpc(app, cookie).q("home.get"));
  assert.equal(body.leaderboard.rows.some((r: { you: boolean }) => r.you), true);
});

test("resolveLearnerId surfaces a handle collision instead of swallowing it", async () => {
  const first = await signUp(app, "first@example.com");
  await resolveLearnerId({ cookie: first });
  await db.update(learners).set({ handle: "learner-taken" });
  const second = await signUp(app, "second@example.com");
  await db.execute(sql`ALTER TABLE learners ALTER COLUMN handle SET DEFAULT 'learner-taken'`);
  try {
    await assert.rejects(resolveLearnerId({ cookie: second }), (e: Error) => /learners_handle_idx/.test(String(e.cause)));
  } finally {
    await db.execute(
      sql`ALTER TABLE learners ALTER COLUMN handle SET DEFAULT 'learner-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)`,
    );
  }
  assert.equal((await db.select().from(learners).where(eq(learners.handle, "learner-taken"))).length, 1);
});
