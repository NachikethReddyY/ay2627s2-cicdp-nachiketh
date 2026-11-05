import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { pool, type Db } from "./client.ts";
import * as schema from "./schema.ts";

export async function withTx<T>(fn: (db: Db, client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined; // set when the connection may be unusable, so release() destroys it
  try {
    await client.query("BEGIN");
    const out = await fn(drizzle(client, { schema }) as unknown as Db, client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      broken = rollbackError as Error; // keep the original error; do not return this client to the pool
    }
    throw e;
  } finally {
    client.release(broken);
  }
}
