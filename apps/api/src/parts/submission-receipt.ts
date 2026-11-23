import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.ts";

export function practiceReceipt(learnerId: string, revision: string, code: string) {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(JSON.stringify(["practice-feedback", learnerId, revision, code]))
    .digest("hex");
}

export function matchesPracticeReceipt(receipt: string, learnerId: string, revision: string, code: string) {
  return timingSafeEqual(Buffer.from(receipt, "hex"), Buffer.from(practiceReceipt(learnerId, revision, code), "hex"));
}
