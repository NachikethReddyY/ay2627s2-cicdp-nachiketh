import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";
import { env } from "../env.ts";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  basePath: "/api/auth",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: (request) => {
    const origins = [env.PUBLIC_ORIGIN];
    const origin = request?.headers.get("origin");

    // The local editor preview can run on a Vite fallback port (for example
    // 5174) while the API's configured public origin remains 5173. Keep this
    // allowance limited to plain HTTP loopback origins in development.
    if (env.NODE_ENV === "development" && origin) {
      try {
        const parsed = new URL(origin);
        if (
          parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
        ) {
          origins.push(origin);
        }
      } catch {
        // Invalid origins are rejected by Better Auth's normal origin check.
      }
    }

    return origins;
  },
  // shortcut: counts live in memory, so the limit is per API instance; use database storage before running more than one.
  rateLimit: {
    enabled: true,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 10 },
    },
  },
});
