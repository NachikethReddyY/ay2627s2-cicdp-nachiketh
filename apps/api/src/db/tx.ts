import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { pool, type Db } from "./client.ts";
import * as schema from "./schema.ts";

export async function withTx<T>(fn: (db: Db, client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const out = await fn(drizzle(client, { schema }) as unknown as Db, client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      broken = rollbackError as Error;
    }
    throw e;
  } finally {
    client.release(broken);
  }
}
