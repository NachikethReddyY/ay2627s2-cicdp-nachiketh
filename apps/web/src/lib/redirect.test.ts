import assert from "node:assert/strict";
import test from "node:test";

// safeRedirect reads location.origin, which Node doesn't have.
(globalThis as { location?: unknown }).location = { origin: "https://learnquest.example" };
const { safeRedirect, loginUrl } = await import("./redirect.ts");

test("same-origin paths survive with their query and hash", () => {
  assert.equal(safeRedirect("/play?lesson=a&course=b#x"), "/play?lesson=a&course=b#x");
  assert.equal(safeRedirect("/explore"), "/explore");
});

test("anything that could leave the site falls back to home", () => {
  for (const bad of [null, undefined, "", "https://evil.example/", "//evil.example/x", "/\\evil.example", "\\\\evil.example", "javascript:alert(1)", "/ok\u0000", "explore", "/a/..//evil.example", "/%2e%2e//evil.example", "/a/b/../..//evil.example/x"]) {
    assert.equal(safeRedirect(bad), "/", String(bad));
  }
});

test("loginUrl round-trips through safeRedirect", () => {
  const path = "/play?lesson=a&course=b";
  const param = new URL(loginUrl(path), "https://learnquest.example").searchParams.get("redirect");
  assert.equal(safeRedirect(param), path);
});
