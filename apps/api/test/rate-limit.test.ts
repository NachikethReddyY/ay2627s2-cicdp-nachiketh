import "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";

const app = buildApp({ trustProxy: false });
after(() => app.close());

test("the 11th sign-in attempt within a minute gets 429", async () => {
  const attempt = () =>
    app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "nobody@example.com", password: "nope-nope-nope" },
    });

  for (let i = 0; i < 10; i++) assert.equal((await attempt()).statusCode, 401);
  assert.equal((await attempt()).statusCode, 429);
});
