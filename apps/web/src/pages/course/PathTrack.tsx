import { motion, useReducedMotion } from "framer-motion";

// One S-curve per level: x is each node's offset from the centre line, y climbs from the bottom row.
export default function PathTrack({ xs, lit, row }: { xs: number[]; lit: number; row: number }) {
  const reduce = useReducedMotion();
  const h = xs.length * row;
  const pts = xs.map((x, i) => [x, h - (i + 0.5) * row]);
  const d = (p: number[][]) =>
    p.map(([x, y], i) => {
      if (!i) return `M${x},${y}`;
      const [px, py] = p[i - 1];
      const my = (py + y) / 2;
      return `C${px},${my} ${x},${my} ${x},${y}`;
    }).join(" ");
  return (
    <svg aria-hidden className="course-track" width="1" height={h}>
      <path d={d(pts)} fill="none" stroke="var(--line)" strokeWidth={2} strokeLinecap="round" strokeDasharray="2 8" />
      {lit > 1 && (
        <motion.path
          d={d(pts.slice(0, lit))}
          fill="none"
          stroke="var(--ac)"
          strokeWidth={2.5}
          strokeLinecap="round"
          initial={{ pathLength: reduce ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 1.2, ease: "easeInOut" }}
        />
      )}
    </svg>
  );
}
