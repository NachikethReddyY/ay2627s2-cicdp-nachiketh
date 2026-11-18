import assert from "node:assert/strict";
import { test } from "node:test";
import type { HttpPost } from "../src/auth.ts";
import { cookieHeader, cookiesFromResponse, parseSetCookie, signInValidator, storageStateOf } from "../src/auth.ts";

const SET = "better-auth.session_token=abc.def%3D; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax";

test("parseSetCookie reads attributes into a Playwright cookie", () => {
  const cookie = parseSetCookie(SET, "localhost", 1000);
  assert.deepEqual(cookie, {
    name: "better-auth.session_token",
    value: "abc.def%3D",
    domain: "localhost",
    path: "/",
    expires: 1000 + 604800,
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  });
});

test("parseSetCookie rejects a line with no name", () => {
  assert.equal(parseSetCookie("=oops", "localhost", 0), null);
});

test("later cookies replace earlier ones with the same name", () => {
  const cookies = cookiesFromResponse(["a=1; Path=/", "b=2; Path=/", "a=3; Path=/"], "localhost", 0);
  assert.deepEqual(cookies.map((c) => `${c.name}=${c.value}`), ["a=3", "b=2"]);
});

test("storage state and cookie header are built from the same cookies", () => {
  const cookies = cookiesFromResponse(["a=1", "b=2"], "localhost", 0);
  assert.deepEqual(storageStateOf(cookies), { cookies, origins: [] });
  assert.equal(cookieHeader(cookies), "a=1; b=2");
});

test("signInValidator signs in after an existing-user sign-up and sends the web origin", async () => {
  const seen: { url: string; origin: string }[] = [];
  const post: HttpPost = async (url, _body, headers) => {
    seen.push({ url, origin: headers.origin });
    if (url.endsWith("/sign-up/email")) return { status: 422, setCookies: [], body: "exists" };
    return { status: 200, setCookies: [SET], body: "{}" };
  };
  const cookies = await signInValidator(post, 0);
  assert.equal(cookies[0].name, "better-auth.session_token");
  assert.deepEqual(seen.map((s) => s.origin), ["http://localhost:5173", "http://localhost:5173"]);
  assert.ok(seen[1].url.endsWith("/api/auth/sign-in/email"));
});

test("signInValidator fails loudly when sign-in returns no cookie", async () => {
  const post: HttpPost = async () => ({ status: 200, setCookies: [], body: "{}" });
  await assert.rejects(() => signInValidator(post, 0), /no session cookie/);
});

test("signInValidator fails on a server error during sign-up", async () => {
  const post: HttpPost = async () => ({ status: 500, setCookies: [], body: "boom" });
  await assert.rejects(() => signInValidator(post, 0), /sign-up failed with 500/);
});
