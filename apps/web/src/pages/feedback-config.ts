import type { RouterOutputs } from "../lib/trpc";

export const REPO_URL = "https://github.com/NachikethReddyY/ay2627s2-cicdp-nachiketh";

export const FEEDBACK_URL = "/feedback";

export type FeedbackCategory = RouterOutputs["admin"]["feedback"]["get"]["category"];

export const categories = {
  bug: "Bug report",
  feature: "Feature request",
  general: "General feedback",
} satisfies Record<FeedbackCategory, string>;
