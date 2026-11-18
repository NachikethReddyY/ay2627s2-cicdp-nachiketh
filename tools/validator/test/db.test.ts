import assert from "node:assert/strict";
import { test } from "node:test";
import { adminUrl, assertSafeDatabase, databaseName, databaseUrl, DEFAULT_DATABASE_URL, LEARNER_DATA_TABLES, ownerRole, postgresStartHint, truncateStatement } from "../src/db.ts";

test("database url defaults and can be overridden", () => {
  assert.equal(databaseUrl({}), DEFAULT_DATABASE_URL);
  assert.equal(databaseUrl({ VALIDATOR_DATABASE_URL: "postgres://a/b" }), "postgres://a/b");
  assert.equal(databaseName(DEFAULT_DATABASE_URL), "learnquest_validator");
});

test("the validator refuses the shared test and system databases", () => {
  assert.throws(() => assertSafeDatabase("postgres://u:p@h:5432/learnquest_test"));
  assert.throws(() => assertSafeDatabase("postgres://u:p@h:5432/postgres"));
  assert.throws(() => assertSafeDatabase("postgres://u:p@h:5432/some_other_test"));
  assert.equal(assertSafeDatabase(DEFAULT_DATABASE_URL), "learnquest_validator");
});

test("database names with odd characters are rejected", () => {
  assert.throws(() => databaseName("postgres://u:p@h:5432/a%22b"));
});

test("admin url targets the postgres database unless overridden", () => {
  assert.equal(adminUrl(DEFAULT_DATABASE_URL, {}), "postgres://learnquest:learnquest@localhost:5432/postgres");
  assert.equal(adminUrl(DEFAULT_DATABASE_URL, { VALIDATOR_ADMIN_URL: "postgres://root@h/postgres" }), "postgres://root@h/postgres");
  assert.equal(ownerRole(DEFAULT_DATABASE_URL), "learnquest");
});

test("truncate statement quotes every table and covers learner data only", () => {
  assert.equal(truncateStatement(["attempts", "mastery"]), 'TRUNCATE TABLE "attempts", "mastery" RESTART IDENTITY');
  for (const kept of ["lessons", "steps", "worlds", "user", "learners"]) assert.ok(!LEARNER_DATA_TABLES.includes(kept));
  assert.ok(LEARNER_DATA_TABLES.includes("attempts"));
  assert.ok(LEARNER_DATA_TABLES.includes("mastery"));
});

test("the postgres hint says how to start it", () => {
  const hint = postgresStartHint(DEFAULT_DATABASE_URL);
  assert.match(hint, /docker compose up -d --wait postgres/);
  assert.match(hint, /VALIDATOR_DATABASE_URL/);
  assert.match(hint, /localhost:5432/);
});

test("only validator-named databases are managed", () => {
  for (const name of ["learnquest", "neondb", "postgres", "learnquest_test", "learnquest_validator_test", "other"]) {
    assert.throws(() => assertSafeDatabase(`postgres://u:p@h:5432/${name}`), /refusing/, name);
  }
  assert.equal(assertSafeDatabase("postgres://u:p@h:5432/learnquest_validator"), "learnquest_validator");
  assert.equal(assertSafeDatabase("postgres://u:p@h:5432/learnquest_validator_2"), "learnquest_validator_2");
});
