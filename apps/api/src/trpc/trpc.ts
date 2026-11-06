import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { resolveLearnerId } from "../auth/guards.ts";

export const createContext = ({ req }: CreateFastifyContextOptions) => ({ req });

const t = initTRPC.context<ReturnType<typeof createContext>>().create({
  isDev: false, // never send stack traces
  errorFormatter: ({ shape, error }) => {
    // Mirrors app.ts: an unset NODE_ENV counts as production, so internal errors are not echoed there.
    const devLike = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
    return error.code === "INTERNAL_SERVER_ERROR" && !devLike ? { ...shape, message: "Internal error" } : shape;
  },
});

export const router = t.router;

// Auth runs before any .input() that a procedure adds, so a bad body without a session is still UNAUTHORIZED.
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const learnerId = await resolveLearnerId(ctx.req.headers);
  if (!learnerId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  return next({ ctx: { learnerId } });
});

// Admin-only calls (curation). The flag lives on the learner row and is set only in the database.
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const { rows } = await db.execute(sql`SELECT 1 FROM learners WHERE id = ${ctx.learnerId} AND is_admin`);
  if (rows.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Admins only" });
  return next();
});
