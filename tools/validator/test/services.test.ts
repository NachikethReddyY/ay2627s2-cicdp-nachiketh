import assert from "node:assert/strict";
import { test } from "node:test";
import { apiEnv, appEnv, engineEnv, isValidatorCommand, serviceSpecs, VALIDATOR_ENGINE_TOKEN } from "../src/services.ts";

const URL = "postgres://u:p@localhost:5432/learnquest_validator";

test("app env points migrate, seed and the API at one database and the web origin", () => {
  const env = appEnv(URL);
  assert.equal(env.DATABASE_URL, URL);
  assert.equal(env.DATABASE_URL_UNPOOLED, URL);
  assert.equal(env.PUBLIC_ORIGIN, "http://localhost:5173");
  assert.ok(env.BETTER_AUTH_SECRET.length >= 32);
});

test("api env adds the engine only when asked", () => {
  assert.equal(apiEnv(URL, false).ENGINE_TOKEN, undefined);
  assert.equal(apiEnv(URL, false).PORT, "3000");
  const withEngine = apiEnv(URL, true);
  assert.equal(withEngine.ENGINE_URL, "http://localhost:8000");
  assert.equal(withEngine.ENGINE_TOKEN, VALIDATOR_ENGINE_TOKEN);
});

test("engine token is long enough for the API to accept", () => {
  assert.ok(VALIDATOR_ENGINE_TOKEN.length >= 32);
  assert.equal(engineEnv().LLM_MODEL, "openai/fake-llm");
  assert.equal(engineEnv().LLM_API_BASE, "http://localhost:8080/v1");
});

test("service specs list the engine only with --engine and start the API after it", () => {
  const without = serviceSpecs("/repo", URL, false).map((s) => s.name);
  assert.deepEqual(without, ["fake-llm", "api", "web"]);
  const withEngine = serviceSpecs("/repo", URL, true).map((s) => s.name);
  assert.deepEqual(withEngine, ["fake-llm", "engine", "api", "web"]);
});

test("validator services override the PostHog settings inherited from local development", () => {
  const specs = serviceSpecs("/repo", URL, true);
  const trackedServices = specs.filter(({ name }) => name !== "fake-llm");
  for (const { env } of trackedServices) {
    assert.equal(env.POSTHOG_HOST, "");
    assert.equal(env.POSTHOG_PROJECT_TOKEN, "");
  }
});

test("health URLs match the real routes", () => {
  const specs = Object.fromEntries(serviceSpecs("/repo", URL, true).map((s) => [s.name, s]));
  assert.equal(specs.api.healthUrl, "http://localhost:3000/api/healthz");
  assert.equal(specs.web.healthUrl, "http://localhost:5173/");
  assert.equal(specs["fake-llm"].healthUrl, "http://localhost:8080/healthz");
  assert.deepEqual(specs.web.args.slice(-5), ["--port", "5173", "--host", "127.0.0.1", "--strictPort"]);
});

test("only processes started by the validator are recognised as ours", () => {
  const root = "/work/learnquest";
  assert.equal(isValidatorCommand("/usr/bin/node /work/learnquest/apps/api/src/server.ts", root), true);
  assert.equal(isValidatorCommand("node pnpm.cjs --filter @learnquest/web exec vite --port 5173", root), true);
  assert.equal(isValidatorCommand("/usr/bin/python uvicorn learnquest_engine.server:app", root), true);
  assert.equal(isValidatorCommand("/Applications/Safari.app/Contents/MacOS/Safari", root), false);
});
