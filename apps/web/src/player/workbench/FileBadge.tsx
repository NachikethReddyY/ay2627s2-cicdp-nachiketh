// Language badge for a file name, coloured from the workbench tokens (--tsbg etc.).
const BADGES: Record<string, { label: string; kind: string }> = {
  ts: { label: "TS", kind: "ts" },
  tsx: { label: "TS", kind: "ts" },
  js: { label: "JS", kind: "js" },
  jsx: { label: "JS", kind: "js" },
  py: { label: "PY", kind: "py" },
  md: { label: "MD", kind: "md" },
};

export default function FileBadge({ path }: { path: string }) {
  const b = BADGES[path.split(".").pop()?.toLowerCase() ?? ""] ?? BADGES.md;
  return (
    <span className="wb-badge" style={{ background: `var(--${b.kind}bg)`, color: `var(--${b.kind}tx)` }} aria-hidden="true">
      {b.label}
    </span>
  );
}
