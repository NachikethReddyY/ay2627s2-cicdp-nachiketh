import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";

// The migration command. It reads only the database URL, not the full API settings, so a deploy job that runs it
// needs no app secrets. The direct URL wins over the pooled one, as in env.ts.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL (or DATABASE_URL_UNPOOLED) is required to run migrations");

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
} finally {
  await pool.end();
}
