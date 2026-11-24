import { DrizzleQueryError, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import pg from "pg";
import { z } from "zod";
import { db } from "../db/client.ts";
import { protectedProcedure, router } from "../trpc/trpc.ts";

const blockedWords = new Set(["admin", "administrator", "fuck", "learnslop", "moderator", "shit", "sloppy", "support"]);
const localToday = sql`date_trunc('day', now() AT TIME ZONE timezone)`;
const changedBeforeToday = sql`(handle_updated_at AT TIME ZONE timezone) < ${localToday}`;
const nextLocalDay = sql`(${localToday} + interval '1 day')`;
const profileFields = sql`
  handle,
  is_admin AS "isAdmin",
  handle_updated_at IS NULL AS "onboardingRequired",
  CASE WHEN NOT (${changedBeforeToday})
    THEN (extract(epoch FROM ${nextLocalDay} AT TIME ZONE timezone) * 1000)::float8
  END AS "nextChangeAt",
  CASE WHEN NOT (${changedBeforeToday})
    THEN to_char(${nextLocalDay}, 'YYYY-MM-DD')
  END AS "nextChangeDate"`;
const Profile = z.object({
  handle: z.string(),
  isAdmin: z.boolean(),
  onboardingRequired: z.boolean(),
  nextChangeAt: z.number().nullable(),
  nextChangeDate: z.iso.date().nullable(),
});
type Profile = z.infer<typeof Profile>;

async function readProfile(learnerId: string) {
  const { rows: [profile] } = await db.execute<Profile>(sql`SELECT ${profileFields} FROM learners WHERE id = ${learnerId}`);
  if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Learner profile not found." });
  return profile;
}

function normalizeHandle(raw: string) {
  const handle = raw.trim();
  if (handle.includes("@")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a handle without an email address." });
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Use 3 to 20 letters, numbers, or underscores." });
  }
  const lowercase = handle.toLowerCase();
  if (lowercase.split("_").some((word) => blockedWords.has(word))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That handle contains a reserved or blocked word. Choose another handle." });
  }
  return lowercase;
}

export const handleRouter = router({
  profile: protectedProcedure.output(Profile).query(({ ctx }) => readProfile(ctx.learnerId)),
  save: protectedProcedure.input(z.object({ handle: z.string() })).output(Profile).mutation(async ({ ctx, input }) => {
    const handle = normalizeHandle(input.handle);
    try {
      const { rows: [updated] } = await db.execute<Profile>(sql`
        UPDATE learners SET handle = ${handle}, handle_updated_at = now()
        WHERE id = ${ctx.learnerId} AND (
          handle_updated_at IS NULL OR (handle <> ${handle} AND ${changedBeforeToday})
        )
        RETURNING ${profileFields}`);
      if (updated) return updated;
    } catch (error) {
      if (error instanceof DrizzleQueryError && error.cause instanceof pg.DatabaseError
        && error.cause.code === "23505" && error.cause.constraint === "learners_handle_idx") {
        throw new TRPCError({ code: "CONFLICT", message: "That handle is taken. Choose another handle." });
      }
      throw error;
    }
    const profile = await readProfile(ctx.learnerId);
    if (profile.handle === handle) return profile;
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "You can change your handle once per calendar day in your account time zone." });
  }),
});
