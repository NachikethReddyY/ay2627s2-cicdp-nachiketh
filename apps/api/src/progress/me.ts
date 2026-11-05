import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";

// Names are checked against Postgres, not Intl: the zone is used in `AT TIME ZONE`, where Postgres reads
// a POSIX offset like "+05:00" with the opposite sign to ISO. Only names in pg_timezone_names are stored.
const TimeZone = z.string().max(64);

// Empty body is a no-op. COALESCE keeps any field that was not sent.
const meUpdate = protectedProcedure
  .input(
    z
      .object({
        timezone: TimeZone.optional(),
        dailyGoalXp: z.union([z.literal(30), z.literal(50), z.literal(100)]).optional(),
      })
      .nullish(),
  )
  .output(z.void())
  .mutation(async ({ ctx, input }) => {
    const { timezone, dailyGoalXp } = input ?? {};
    if (timezone !== undefined) {
      const { rows } = await db.execute(sql`SELECT 1 FROM pg_timezone_names WHERE name = ${timezone}`);
      if (rows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown IANA time zone" });
    }
    await db.execute(sql`
      UPDATE learners
      SET timezone = COALESCE(${timezone ?? null}, timezone),
        daily_goal_xp = COALESCE(${dailyGoalXp ?? null}, daily_goal_xp)
      WHERE id = ${ctx.learnerId}`);
  });

export const meRouter = router({ update: meUpdate });
