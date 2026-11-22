import { out, signUp, trpc } from "./helpers.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { resolveLearnerId } from "../src/auth/guards.ts";
import { db } from "../src/db/client.ts";
import { learners } from "../src/db/schema.ts";

const app = buildApp();
after(() => app.close());

test("weekly leaderboard rows expose only generated handles and XP, even for legacy opt-outs", async () => {
  const cookie = await signUp(app, "hidden-local-part@example.com");
  const learnerId = await resolveLearnerId({ cookie });
  const [learner] = await db.update(learners)
    .set({ leaderboardOptIn: false })
    .where(eq(learners.id, learnerId))
    .returning({ handle: learners.handle });
  assert.match(learner!.handle, /^learner-[0-9a-f]{10}$/);

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
