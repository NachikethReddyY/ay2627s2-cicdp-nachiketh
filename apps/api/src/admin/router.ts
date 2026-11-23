import { adminProcedure, router } from "../trpc/trpc.ts";
import { aiSpendByDay } from "./ai-spend.ts";
import { feedbackAdminRouter } from "../feedback/admin.ts";

export const adminRouter = router({
  dashboard: adminProcedure.query(aiSpendByDay),
  feedback: feedbackAdminRouter,
});
