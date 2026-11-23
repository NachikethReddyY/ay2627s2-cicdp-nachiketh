import { adminProcedure, router } from "../trpc/trpc.ts";
import { aiSpendByDay } from "./ai-spend.ts";

export const adminRouter = router({
  dashboard: adminProcedure.query(aiSpendByDay),
});
