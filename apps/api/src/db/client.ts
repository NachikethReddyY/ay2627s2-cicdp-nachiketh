import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

// Explicit pool limits: a slow caller must fail fast instead of queueing forever, and a session that dies
// mid-transaction must not hold row locks (idle_in_transaction_session_timeout, server side).
const POOL_MAX = 10;
const CONNECTION_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 30_000;
const IDLE_IN_TX_TIMEOUT_MS = 30_000;

// Direct connection, not a transaction pooler (see docs/api-plan.md §1).
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: POOL_MAX,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  options: `-c idle_in_transaction_session_timeout=${IDLE_IN_TX_TIMEOUT_MS}`,
});
export const db = drizzle(pool, { schema });
export type Db = typeof db;
