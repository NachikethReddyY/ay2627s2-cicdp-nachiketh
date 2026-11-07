// Language badges, coloured from the workbench tokens (--tsbg etc.).
type Kind = "ts" | "js" | "py" | "md" | "json";
const BADGES: Record<string, { label: string; kind: Kind }> = {
  ts: { label: "TS", kind: "ts" },
  tsx: { label: "TS", kind: "ts" },
  js: { label: "JS", kind: "js" },
  jsx: { label: "JS", kind: "js" },
  py: { label: "PY", kind: "py" },
  md: { label: "MD", kind: "md" },
  json: { label: "{}", kind: "json" },
};

const pick = (path: string) => BADGES[path.split(".").pop()?.toLowerCase() ?? ""] ?? BADGES.md;
// JSON reuses the JS colours, as in the design.
const tok = (k: Kind) => (k === "json" ? "js" : k);

/** The palette's badge: a coloured box that CSS sizes (.wb-badge). */
export default function FileBadge({ path }: { path: string }) {
  const b = pick(path);
  return (
    <span className="wb-badge" style={{ background: `var(--${tok(b.kind)}bg)`, color: `var(--${tok(b.kind)}tx)` }} aria-hidden="true">
      {b.label}
    </span>
  );
}

/** The tree and breadcrumb badge from Main.dc.html: a 14 px rounded square in a 16 px box, label 7.2 px (MD 6.6, {} 8). */
export function FileIcon({ path, size = 18 }: { path: string; size?: number }) {
  const b = pick(path);
  const t = tok(b.kind);
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" className="flex-none">
      <rect x="1" y="1" width="14" height="14" rx="3" style={{ fill: `var(--${t}bg)` }} />
      <text
        x="8"
        y="11.3"
        textAnchor="middle"
        fontFamily="Geist, system-ui, sans-serif"
        fontSize={b.kind === "json" ? 8 : b.kind === "md" ? 6.6 : 7.2}
        fontWeight="700"
        style={{ fill: `var(--${t}tx)` }}
      >
        {b.label}
      </text>
    </svg>
  );
}
