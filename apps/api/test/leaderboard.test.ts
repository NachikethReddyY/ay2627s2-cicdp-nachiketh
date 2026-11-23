import { code, out, signUp, trpc } from "./helpers.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { resolveLearnerId } from "../src/auth/guards.ts";
import { db } from "../src/db/client.ts";
import { learners, user } from "../src/db/schema.ts";

const app = buildApp();
after(() => app.close());

test("weekly leaderboard rows expose only generated handles and XP", async () => {
  const cookie = await signUp(app, "hidden-local-part@example.com");
  const learnerId = await resolveLearnerId({ cookie });
  assert.ok(learnerId);
  await db.update(user).set({ name: "hidden-local-part" }).where(eq(user.email, "hidden-local-part@example.com"));
  const [learner] = await db.select({ handle: learners.handle }).from(learners).where(eq(learners.id, learnerId));
  assert.match(learner!.handle, /^learner_[0-9a-f]{10}$/);

  const viewer = trpc(app, await signUp(app, "viewer@example.com"));
  const response = await viewer.q("home.get");
  assert.equal(response.statusCode, 200, response.body);
  const { leaderboard } = out(response);
  assert.equal(leaderboard.rows.length, 2);
  assert.ok(leaderboard.rows.some((row: { handle: string }) => row.handle === learner!.handle));
  for (const row of leaderboard.rows) {
    assert.deepEqual(Object.keys(row).sort(), ["handle", "xp"]);
  }
  assert.equal("optedIn" in leaderboard, false);
  assert.doesNotMatch(JSON.stringify(leaderboard), /hidden-local-part|example\.com|Test/);
});

test("learners confirm or change their public handles without exposing account details", async () => {
  const cookie = await signUp(app, "hidden-local-part@example.com");
  const learnerId = await resolveLearnerId({ cookie });
  assert.ok(learnerId);
  const self = trpc(app, cookie);
  const viewer = trpc(app, await signUp(app, "viewer@example.com"));
  assert.equal((await trpc(app).q("me.handle.profile")).statusCode, 401);
  assert.equal((await trpc(app).m("me.handle.save", { handle: "intruder" })).statusCode, 401);

  const initial = await self.q("me.handle.profile");
  assert.equal(initial.statusCode, 200, initial.body);
  const { handle } = out(initial);
  assert.match(handle, /^learner_[0-9a-f]{10}$/);
  assert.deepEqual(out(initial), { handle, onboardingRequired: true, nextChangeAt: null });

  for (const [invalid, message] of [["me@example.com", /without an email/], ["too-short!", /3 to 20/], ["Site_Admin", /reserved or blocked/]] as const) {
    const rejected = await self.m("me.handle.save", { handle: invalid });
    assert.equal(code(rejected), "BAD_REQUEST");
    assert.match(rejected.json().error.message, message);
  }

  const confirmed = await self.m("me.handle.save", { handle });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(out(confirmed).onboardingRequired, false);
  assert.ok(out(confirmed).nextChangeAt > Date.now());
  assert.deepEqual(out(await self.m("me.handle.save", { handle })), out(confirmed));
  assert.equal(code(await self.m("me.handle.save", { handle: "new_handle" })), "TOO_MANY_REQUESTS");

  await db.update(learners).set({ handleUpdatedAt: new Date(0) }).where(eq(learners.id, learnerId));
  assert.equal(out(await self.q("me.handle.profile")).nextChangeAt, null);
  const changed = await self.m("me.handle.save", { handle: "New_Handle" });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(out(changed).handle, "new_handle");
  const duplicate = await viewer.m("me.handle.save", { handle: "NEW_HANDLE" });
  assert.equal(code(duplicate), "CONFLICT");
  assert.match(duplicate.json().error.message, /taken/);
  assert.equal(out(await viewer.q("me.handle.profile")).onboardingRequired, true);

  const { leaderboard } = out(await viewer.q("home.get"));
  assert.ok(leaderboard.rows.some((row: { handle: string }) => row.handle === "new_handle"));
  assert.doesNotMatch(JSON.stringify(leaderboard), /hidden-local-part|example\.com|Test/);
  assert.ok(leaderboard.rows.every((row: { handle: string }) => row.handle !== handle));
});
