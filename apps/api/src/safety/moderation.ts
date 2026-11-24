import { env } from "../env.ts";
import { callEngine } from "../engine-client/client.ts";
import { reserveAiSpend } from "../config/budget.ts";
import { measureGeneration } from "../ai/telemetry.ts";

export const CATEGORIES = [
  "hate", "harassment", "self-harm", "sexual", "violence", "illicit", "jailbreak",
] as const;
type ModerationResult = { flagged: boolean; scores: Partial<Record<(typeof CATEGORIES)[number], number>> };
export type ModerationClient = (input: string) => Promise<ModerationResult>;
type ModerationCheck = { status: "allowed" | "flagged" } | { status: "unavailable"; cause: unknown };

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

export async function checkModeration(input: string, client: ModerationClient = moderationClient): Promise<ModerationCheck> {
  try {
    const result = await client(input);
    const allowed = !result.flagged && Object.values(result.scores).every((score) => score < THRESHOLD);
    return { status: allowed ? "allowed" : "flagged" };
  } catch (cause) {
    return { status: "unavailable", cause };
  }
}

export async function isSafe(
  input: string,
  client: ModerationClient = moderationClient,
  { failOpen = false }: { failOpen?: boolean } = {},
): Promise<boolean> {
  if (allowList.test(input.trim())) return true;
  const result = await checkModeration(input, client);
  if (result.status === "unavailable") {
    if (failOpen) console.warn("moderation unavailable; text allowed", result.cause instanceof Error ? result.cause.message : "");
    return failOpen;
  }
  return result.status === "allowed";
}

export const isSafeText = (input: string) => input.trim().length < 4 ? Promise.resolve(true) : isSafe(input, moderationClient, { failOpen: true });
