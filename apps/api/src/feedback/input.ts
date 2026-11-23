import { feedbackLimits } from "@learnquest/product-limits";
import { z } from "zod";

export const reportId = z.uuidv4();

const text = (max: number) => z.string().trim().min(1).max(max).refine((value) => !value.includes("\u0000"));
const fields = {
  id: reportId,
  name: text(feedbackLimits.name),
  email: z.string().trim().max(feedbackLimits.email).pipe(z.email()),
  details: text(feedbackLimits.details),
};

const base64Limit = Math.ceil(feedbackLimits.screenshotBytes / 3) * 4;
export const bodyLimit = base64Limit + 40 * 1024;

export const submission = z.discriminatedUnion("category", [
  z.strictObject({
    ...fields,
    category: z.literal("bug"),
    location: text(feedbackLimits.location),
    screenshot: z.string().min(1).max(base64Limit).optional(),
  }),
  z.strictObject({ ...fields, category: z.enum(["feature", "general"]) }),
]);
