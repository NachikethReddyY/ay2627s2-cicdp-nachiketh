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

// The 7 days ending today, oldest first.
export function week(solvedByDay: Map<string, number>, today: string) {
  const days = [today];
  while (days.length < 7) days.unshift(prev(days[0]!));
  return days.map((day) => ({ day, solved: solvedByDay.get(day) ?? 0 }));
}
