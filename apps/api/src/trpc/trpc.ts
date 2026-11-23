import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { isAdmin, resolveLearnerId } from "../auth/guards.ts";

export const createContext = ({ req, res }: CreateFastifyContextOptions) => ({ req, res });

const t = initTRPC.context<ReturnType<typeof createContext>>().create({
  isDev: false,
  errorFormatter: ({ shape, error }) => {
    const devLike = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
    return error.code === "INTERNAL_SERVER_ERROR" && !devLike ? { ...shape, message: "Internal error" } : shape;
  },
});

export const router = t.router;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const learnerId = await resolveLearnerId(ctx.req.headers);
  if (!learnerId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  return next({ ctx: { learnerId } });
});

export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!await isAdmin(ctx.learnerId)) throw new TRPCError({ code: "FORBIDDEN", message: "Admins only" });
  ctx.res.header("Cache-Control", "private, no-store");
  return next();
});
