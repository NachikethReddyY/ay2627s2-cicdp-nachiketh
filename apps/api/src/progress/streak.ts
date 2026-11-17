const SOLVES_PER_DAY = 3;

const prev = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// Days are YYYY-MM-DD in the learner's zone. Today doesn't break the streak until it is over.
export function streak(solvedByDay: Map<string, number>, today: string) {
  const hit = (day: string) => (solvedByDay.get(day) ?? 0) >= SOLVES_PER_DAY;
  let day = hit(today) ? today : prev(today);
  let n = 0;
  while (hit(day)) {
    n++;
    day = prev(day);
  }
  return n;
}

const shift = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The calendar week (Monday to Sunday) that holds today, oldest first. Days before today are past, days after are future.
export function week(solvedByDay: Map<string, number>, today: string) {
  const offset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const day = shift(today, i - offset);
    const state: "past" | "today" | "future" = day < today ? "past" : day === today ? "today" : "future";
    return { day, solved: solvedByDay.get(day) ?? 0, state };
  });
}
