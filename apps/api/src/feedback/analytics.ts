import { env } from "../env.ts";
import type { feedbackReports } from "../db/schema.ts";

export async function captureFeedback(id: string, category: typeof feedbackReports.$inferSelect.category) {
  const { POSTHOG_PROJECT_TOKEN: token, POSTHOG_HOST: host } = env;
  if (!token || !host) return;
  const response = await fetch(new URL("/capture/", host), {
    method: "POST",
    headers: { "content-type": "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(2_000),
    body: JSON.stringify({
      api_key: token,
      event: "feedback_submitted",
      properties: {
        distinct_id: id,
        category,
        $process_person_profile: false,
        $geoip_disable: true,
      },
    }),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Feedback analytics unavailable");
}
