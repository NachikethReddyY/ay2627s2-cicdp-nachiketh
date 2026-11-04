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
    signal: AbortSignal.timeout(moderationTimeoutMs), // an abort throws, so isSafe applies its usual failOpen policy
  });
  if (!response.ok) throw new Error("Moderation provider unavailable");
  const json = (await response.json()) as { results?: Array<{ flagged?: boolean; category_scores?: Record<string, number> }> };
  const result = json.results?.[0];
  if (!result || !result.category_scores) throw new Error("Invalid moderation response");
  return { flagged: !!result.flagged, scores: result.category_scores };
};
let moderationClient: ModerationClient = provider;
let moderationTimeoutMs = 5000;

export function setModerationClient(client: ModerationClient): void {
  moderationClient = client;
}

/** Tests shorten the provider timeout instead of waiting on it. */
export function setModerationTimeoutForTests(ms: number): void {
  moderationTimeoutMs = ms;
}

/**
 * failOpen: when the moderation service is unavailable, allow the text (learner topics and generated lessons).
 * Images never fail open: imagegen calls this without it, so a safety outage stops images but not lessons.
 */
export async function isSafe(
  input: string,
  client: ModerationClient = moderationClient,
  { failOpen = false }: { failOpen?: boolean } = {},
): Promise<boolean> {
  // Only trusted, exact curriculum topics bypass the provider. Learner text never enters this list.
  if (allowList.test(input.trim())) return true;
  try {
    const result = await client(input);
    // Only the categories the provider returned: omni-moderation has no jailbreak score, and a missing one must not block.
    return !result.flagged && Object.values(result.scores).every((score) => score < THRESHOLD);
  } catch (error) {
    if (failOpen) console.warn("moderation unavailable; text allowed", error instanceof Error ? error.message : "");
    return failOpen;
  }
}

/** Text check for topics and generated lessons: fails open when moderation is down. */
export const isSafeText = (input: string) => isSafe(input, moderationClient, { failOpen: true });
