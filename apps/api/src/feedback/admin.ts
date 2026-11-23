import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { feedbackReports as reports } from "../db/schema.ts";
import { adminProcedure, router } from "../trpc/trpc.ts";
import { reportId } from "./input.ts";

const pageSize = 20;
const summary = { id: reports.id, category: reports.category, createdAt: reports.createdAt };
const received = eq(reports.received, true);

export const feedbackAdminRouter = router({
  list: adminProcedure.input(z.object({ before: reportId.optional() })).query(async ({ input }) => {
    const before = input.before === undefined ? undefined : sql`
      (${reports.createdAt}, ${reports.id}) < (SELECT created_at, id FROM feedback_reports WHERE id = ${input.before} AND received)
    `;
    const rows = await db.select(summary).from(reports).where(and(received, before))
      .orderBy(desc(reports.createdAt), desc(reports.id)).limit(pageSize + 1);
    const items = rows.slice(0, pageSize);
    return { items, next: rows.length > pageSize ? items.at(-1)?.id : undefined };
  }),
  get: adminProcedure.input(reportId).query(async ({ input }) => {
    const [report] = await db.select({
      ...summary,
      name: reports.name,
      email: reports.email,
      location: reports.location,
      details: reports.details,
      hasScreenshot: sql<boolean>`${reports.screenshotKey} IS NOT NULL`,
    }).from(reports).where(and(received, eq(reports.id, input)));
    if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Feedback report not found" });
    return report;
  }),
});
