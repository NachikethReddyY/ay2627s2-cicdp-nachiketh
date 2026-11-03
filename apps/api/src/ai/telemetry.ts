/** Record provider-call counts and timings without retaining any generated or learner text. */
export async function measureGeneration<T>(operation: "outline" | "lesson" | "part", call: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let outcome: "success" | "error" = "success";
  try {
    return await call();
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    console.info(JSON.stringify({ event: "ai_generation", operation, outcome, count: 1, durationMs: Math.round(performance.now() - started) }));
  }
}
