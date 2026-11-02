import type { ReactNode } from "react";
import type { BlockViewProps } from "../registry.ts";

// Tiny subset: **bold** and *italic*. Anything else (links, HTML) stays literal text.
const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*/g;

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <em key={m.index}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export default function TextView({ block }: BlockViewProps<{ md: string }>) {
  return (
    <div className="min-w-0 max-w-full break-words text-base">
      {block.props.md.split(/\n{2,}/).map((p, i) => (
        <p key={i} className="mb-2 whitespace-pre-line last:mb-0">{inline(p)}</p>
      ))}
    </div>
  );
}
