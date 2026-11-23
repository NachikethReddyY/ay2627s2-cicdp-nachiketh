const guideCalls = new Map<string, { started: number; count: number }>();

export function takeGuideCall(learnerId: string) {
  const now = Date.now();
  for (const [id, window] of guideCalls) if (now - window.started >= 60_000) guideCalls.delete(id);
  const window = guideCalls.get(learnerId);
  if (!window) {
    guideCalls.set(learnerId, { started: now, count: 1 });
    return true;
  }
  if (window.count >= 10) return false;
  window.count++;
  return true;
}
