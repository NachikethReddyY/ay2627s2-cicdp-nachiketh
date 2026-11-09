// Runs a TypeScript program through POST /api/sandbox/run in the real sandbox image. Skipped when Docker or the image is not available.
import { signUp } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildApp } from "../src/app.ts";
import { env } from "../src/env.ts";

const app = buildApp();
after(() => app.close());

const hasImage = spawnSync("docker", ["image", "inspect", env.SANDBOX_IMAGE], { stdio: "ignore" }).status === 0;
const skip = !hasImage && `docker or image ${env.SANDBOX_IMAGE} not available`;

test("a TypeScript program runs through /api/sandbox/run", { skip, timeout: 60_000 }, async () => {
  const cookie = await signUp(app, "ts-run@example.com");
  const headers = { cookie, origin: env.PUBLIC_ORIGIN };
  const was = env.SANDBOX_ENABLED;
  env.SANDBOX_ENABLED = true;
  try {
    const start = await app.inject({ method: "POST", url: "/api/sandbox/run", headers, payload: { language: "typescript", code: "const x: number = 21;\nconsole.log(x * 2);" } });
    assert.equal(start.statusCode, 200, start.body);
    const { id } = start.json() as { id: string };
    let status: { output: string; done: boolean; error?: string } = { output: "", done: false };
    for (let i = 0; i < 100 && !status.done; i++) {
      await new Promise((r) => setTimeout(r, 200));
      status = (await app.inject({ method: "GET", url: `/api/sandbox/run/${id}`, headers })).json();
    }
    assert.equal(status.done, true);
    assert.equal(status.error, undefined);
    assert.equal(status.output.trim(), "42");
  } finally {
    env.SANDBOX_ENABLED = was;
  }
});
