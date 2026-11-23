import assert from "node:assert/strict";
import { test } from "node:test";
import { mvpLimits, plans, proLimits } from "./index.ts";

test("the free plan states the same numbers the API enforces", () => {
  const free = plans.find((plan) => plan.id === "free");
  assert.ok(free);
  assert.ok(free.limits.some((line) => line.startsWith(`${mvpLimits.aiPathsPerDay} AI-generated learning paths`)));
  assert.ok(free.limits.some((line) => line.startsWith(`${mvpLimits.imagesPerDay} AI-generated image`)));
});

test("pro is listed as coming soon with its planned limits", () => {
  const pro = plans.find((plan) => plan.id === "pro");
  assert.equal(pro?.status, "coming-soon");
  assert.ok(pro?.limits.some((line) => line.startsWith(`${proLimits.aiPathsPerDay} AI-generated learning paths`)));
  assert.ok(pro?.limits.some((line) => line.startsWith(`${proLimits.imagesPerDay} AI-generated images`)));
  assert.ok(proLimits.aiPathsPerDay > mvpLimits.aiPathsPerDay);
});
