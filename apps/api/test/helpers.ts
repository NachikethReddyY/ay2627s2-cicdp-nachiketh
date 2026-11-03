// Import this before any ../src module: env.ts reads process.env when it is first imported.
process.env.NODE_ENV = "test";
// Tests truncate every table, so they read TEST_DATABASE_URL (never DATABASE_URL) and refuse a non-_test database.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://learnquest:learnquest@localhost:5432/learnquest_test";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test")) {
  throw new Error("Refusing to run tests: the test database name must end with _test");
}
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";
process.env.PUBLIC_ORIGIN ??= "http://localhost:5173";
// inject() connects from 127.0.0.1, so that address stands in for the proxy and its forwarded IP is honoured.
process.env.TRUSTED_PROXY ??= "127.0.0.1";

import { randomInt } from "node:crypto";
import { beforeEach } from "node:test";
import type { FastifyInstance } from "fastify";

// Dynamic imports: static ones would hoist above the env assignments.
const { sql } = await import("drizzle-orm");
const { db } = await import("../src/db/client.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
const { seed } = await import("../src/db/seed.ts");
const { idle } = await import("../src/ai/service.ts");
const { setModerationClient } = await import("../src/safety/moderation.ts");
setModerationClient(async () => ({ flagged: false, scores: { hate: 0, harassment: 0, "self-harm": 0, sexual: 0, violence: 0, illicit: 0, jailbreak: 0 } }));

await runMigrations();

beforeEach(async () => {
  await idle(); // prefetch left running by the previous test would deadlock the truncate
  await db.execute(
    sql`TRUNCATE enrollments, generation_cache, lesson_media, part_completions, path_courses, paths, hint_events, attempts, step_progress, steps, lesson_versions, lessons, concepts, worlds, learners, verification, account, session, "user" CASCADE`,
  );
});

export const PASSWORD = "correct-horse-battery";

// Seeds lesson-1, signs up a user, returns the session cookie header value.
export async function signUp(app: FastifyInstance, email = "a@example.com") {
  await seed();
  // Own client address per call: the sign-up rate limit would otherwise trip across tests in one process.
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}` },
    payload: { email, password: PASSWORD, name: "Test" },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

// tRPC over HTTP: queries are GET ?input=<json>, mutations are POST with the JSON input as the body.
export function trpc(app: FastifyInstance, cookie = "") {
  const url = (path: string) => `/api/trpc/${path}`;
  return {
    q: (path: string, input?: unknown) =>
      app.inject({
        method: "GET",
        url: url(path) + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`),
        headers: { cookie },
      }),
    m: (path: string, input?: unknown, headers: Record<string, string> = {}) =>
      app.inject({
        method: "POST",
        url: url(path),
        headers: { cookie, "content-type": "application/json", ...headers },
        payload: input === undefined ? undefined : JSON.stringify(input),
      }),
  };
}
// Unwraps a successful tRPC response.
export const out = (res: { json(): any }) => res.json().result.data;
// The tRPC error code of a failed response.
export const code = (res: { json(): any }) => res.json().error.data.code as string;
