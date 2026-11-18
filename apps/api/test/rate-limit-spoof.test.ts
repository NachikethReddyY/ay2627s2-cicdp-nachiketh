import "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";

const app = buildApp({ trustProxy: false });
after(() => app.close());

test("rotating x-forwarded-for values do not reset the limit", async () => {
  const attempt = (ip: string) =>
    app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "x-forwarded-for": ip },
      payload: { email: "nobody@example.com", password: "nope-nope-nope" },
    });

  for (let i = 0; i < 10; i++) assert.equal((await attempt(`203.0.113.${i + 1}`)).statusCode, 401);
  assert.equal((await attempt("198.51.100.9")).statusCode, 429);
});
