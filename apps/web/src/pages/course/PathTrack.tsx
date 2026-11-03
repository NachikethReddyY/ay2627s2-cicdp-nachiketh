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
      <path d={d(pts)} fill="none" stroke="#15121F" strokeOpacity={0.3} strokeWidth={3} strokeLinecap="round" strokeDasharray="9 9" />
      {lit > 1 && (
        <>
          <motion.path
            d={d(pts.slice(0, lit))}
            fill="none"
            stroke="#15121F"
            strokeWidth={9}
            strokeLinecap="round"
            initial={{ pathLength: reduce ? 1 : 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: reduce ? 0 : 1.2, ease: "easeInOut" }}
          />
          <motion.path
            d={d(pts.slice(0, lit))}
            fill="none"
            stroke="#2257FF"
            strokeWidth={4}
            strokeLinecap="round"
            initial={{ pathLength: reduce ? 1 : 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: reduce ? 0 : 1.2, ease: "easeInOut" }}
          />
        </>
      )}
    </svg>
  );
}
