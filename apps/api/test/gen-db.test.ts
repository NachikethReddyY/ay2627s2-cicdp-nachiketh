import "./helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { pool } from "../src/db/client.ts";
import { withTx } from "../src/db/tx.ts";

test("withTx keeps the original error when ROLLBACK also fails, and destroys that client", async () => {
  let released: unknown = "not released";
  const original = new Error("original failure");
  await assert.rejects(
    withTx(async (_tx, client) => {
      const release = client.release.bind(client);
      client.release = ((err?: Error | boolean) => {
        released = err;
        return release(err);
      }) as typeof client.release;
      const query = client.query.bind(client) as (...a: unknown[]) => unknown;
      (client as any).query = (text: unknown, ...rest: unknown[]) =>
        text === "ROLLBACK" ? Promise.reject(new Error("rollback failed")) : query(text, ...rest);
      throw original;
    }),
    (e) => e === original,
  );
  assert.ok(released instanceof Error, "a client whose ROLLBACK failed is released with an error so the pool discards it");
  assert.equal((released as Error).message, "rollback failed");
  // The pool still works.
  assert.equal((await pool.query("SELECT 1 AS one")).rows[0].one, 1);
});

test("withTx returns a healthy client to the pool after a normal rollback", async () => {
  let released: unknown = "not released";
  await assert.rejects(
    withTx(async (_tx, client) => {
      const release = client.release.bind(client);
      client.release = ((err?: Error | boolean) => {
        released = err;
        return release(err);
      }) as typeof client.release;
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(released, undefined);
});
