import { test } from "node:test";
import assert from "node:assert/strict";
import { generatorError } from "./generatorErrors.ts";

test("a server failure does not blame the learner's connection", () => {
  assert.doesNotMatch(generatorError("INTERNAL_SERVER_ERROR"), /connection/i);
});

test("a request that never reached the server asks to check the connection", () => {
  assert.match(generatorError(null), /connection/i);
});

test("an unknown code falls back to the connection message", () => {
  assert.match(generatorError("SOMETHING_NEW"), /connection/i);
});
