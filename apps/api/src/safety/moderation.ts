import { env } from "../env.ts";

export const CATEGORIES = [
  "hate", "harassment", "self-harm", "sexual", "violence", "illicit", "jailbreak",
] as const;
export type ModerationResult = { flagged: boolean; scores: Partial<Record<(typeof CATEGORIES)[number], number>> };
export type ModerationClient = (input: string) => Promise<ModerationResult>;

const THRESHOLD = 0.8;
const allowList = /^(javascript|typescript|python|java|c\+\+|rust|go|html|css|sql|programming|coding)$/i;

const provider: ModerationClient = async (input) => {
  if (!env.MODERATION_API_KEY) throw new Error("Moderation is not configured");
  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: { authorization: `Bearer ${env.MODERATION_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "omni-moderation-latest", input }),
  });
  if (!response.ok) throw new Error("Moderation provider unavailable");
  const json = (await response.json()) as { results?: Array<{ flagged?: boolean; category_scores?: Record<string, number> }> };
  const result = json.results?.[0];
  if (!result || !result.category_scores) throw new Error("Invalid moderation response");
  return { flagged: !!result.flagged, scores: result.category_scores };
};
let moderationClient: ModerationClient = provider;

export function setModerationClient(client: ModerationClient): void {
  moderationClient = client;
}

export async function isSafe(input: string, client: ModerationClient = moderationClient): Promise<boolean> {
  // Only trusted, exact curriculum topics bypass the provider. Learner text never enters this list.
  if (allowList.test(input.trim())) return true;
  try {
    const result = await client(input);
    return !result.flagged && CATEGORIES.every((category) => (result.scores[category] ?? 1) < THRESHOLD);
  } catch {
    return false;
  }
}
