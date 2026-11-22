import { env } from "../env.ts";
import { callEngine } from "../engine-client/client.ts";
import { reserveAiSpend } from "../config/budget.ts";
import { measureGeneration } from "../ai/telemetry.ts";

export const CATEGORIES = [
  "hate", "harassment", "self-harm", "sexual", "violence", "illicit", "jailbreak",
] as const;
type ModerationResult = { flagged: boolean; scores: Partial<Record<(typeof CATEGORIES)[number], number>> };
export type ModerationClient = (input: string) => Promise<ModerationResult>;

const THRESHOLD = 0.8;
const allowList = /^(javascript|typescript|python|java|c\+\+|rust|go|html|css|sql|programming|coding)$/i;

const provider: ModerationClient = async (input) => {
  if (!env.MODERATION_API_KEY) throw new Error("Moderation is not configured");
  await reserveAiSpend(env.MODERATION_ESTIMATE_USD);
  const json = await measureGeneration("moderation", () => callEngine<{ results?: Array<{ flagged?: boolean; category_scores?: Record<string, number> }> }>("/v1/moderation", {
    input, model: env.MODERATION_MODEL, apiBase: env.MODERATION_BASE_URL, apiKey: env.MODERATION_API_KEY,
  }, { timeoutMs: moderationTimeoutMs }));
  const result = json.results?.[0];
  if (!result || !result.category_scores) throw new Error("Invalid moderation response");
  return { flagged: !!result.flagged, scores: result.category_scores };
};
let moderationClient: ModerationClient = provider;
let moderationTimeoutMs = 5000;

export function setModerationClient(client: ModerationClient): void {
  moderationClient = client;
}

export function setModerationTimeoutForTests(ms: number): void {
  moderationTimeoutMs = ms;
}

export async function isSafe(
  input: string,
  client: ModerationClient = moderationClient,
  { failOpen = false }: { failOpen?: boolean } = {},
): Promise<boolean> {
  if (allowList.test(input.trim())) return true;
  try {
    const result = await client(input);
    return !result.flagged && Object.values(result.scores).every((score) => score < THRESHOLD);
  } catch (error) {
    if (failOpen) console.warn("moderation unavailable; text allowed", error instanceof Error ? error.message : "");
    return failOpen;
  }
}

export const isSafeText = (input: string) => input.trim().length < 4 ? Promise.resolve(true) : isSafe(input, moderationClient, { failOpen: true });
