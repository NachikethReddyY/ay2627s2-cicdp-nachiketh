import assert from "node:assert/strict";
import { test } from "node:test";
import { readStudioRun, writeStudioRun } from "./studioRun.ts";

test("a Studio draft is available only to the account that wrote it", () => {
  const draft = { clips: [{ index: 0, audio: "data:audio/wav;base64,YQ==" }] };

  writeStudioRun("author", draft);

  assert.deepEqual(readStudioRun("author"), draft);
  assert.deepEqual(readStudioRun("another-account"), {});
});
