import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

async function isolateDatabase() {
  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl || process.env.DATABASE_URL_UNPOOLED) {
    throw new Error("Isolated API tests require TEST_DATABASE_URL and an unset DATABASE_URL_UNPOOLED");
  }
  const url = new URL(baseUrl);
  if (!url.pathname.endsWith("_test")) {
    throw new Error("The test database name must end with _test");
  }
  const database = `api_${randomUUID().replaceAll("-", "")}_test`;
  const client = new pg.Client({ connectionString: baseUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${database}"`);
  } finally {
    await client.end();
  }
  url.pathname = `/${database}`;
  process.env.TEST_DATABASE_URL = url.href;
}

if (import.meta.main) {
  const isolate = process.env.ISOLATE_API_TEST_DATABASES === "true";
  const coverageFile = process.env.API_COVERAGE_FILE;
  const result = spawnSync(process.execPath, [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-lines=87",
    "--test-coverage-branches=83",
    "--test-coverage-exclude=**/*.test.ts",
    "--test-coverage-exclude=test/run.ts",
    ...(coverageFile ? [
      "--test-reporter=tap", "--test-reporter-destination=stdout",
      "--test-reporter=lcov", `--test-reporter-destination=${coverageFile}`,
    ] : []),
    isolate ? "--test-concurrency=4" : "--test-concurrency=1",
    ...(isolate ? ["--import", import.meta.url] : []),
    "test/**/*.test.ts",
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  await isolateDatabase();
}
