export const SPEEDS = [1, 1.25, 1.5, 0.75] as const;

export const nextSpeed = (current: number) => {
  const i = SPEEDS.indexOf(current as (typeof SPEEDS)[number]);
  return SPEEDS[(i + 1) % SPEEDS.length];
};

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function skipTime(current: number, delta: number, duration: number) {
  const next = Math.max(0, current + delta);
  return Number.isFinite(duration) ? Math.min(duration, next) : next;
}

export type Chapter = { start: number; title: string };

export function chapterMarks(chapters: Chapter[], duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return chapters
    .filter((c) => c.start > 0 && c.start < duration)
    .map((c) => ({ left: (c.start / duration) * 100, title: c.title }));
}

export function currentChapter(chapters: Chapter[], time: number) {
  let title: string | null = null;
  for (const c of chapters) if (c.start <= time) title = c.title;
  return title;
}

const MAX_QUOTE = 300;

export function explainPrompt(caption: string, time: number) {
  const text = caption.trim();
  if (!text) return `Explain what the lesson video covers at ${formatTime(time)}.`;
  const quoted = text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE)}…` : text;
  return `Explain this part of the lesson video: "${quoted}"`;
}
