type Props = { label?: string };

const blocks = [
  { glyph: "{ }", tone: "text-[var(--nu)]", delay: "0s" },
  { glyph: "=>", tone: "text-[var(--kw)]", delay: "0.7s" },
  { glyph: "✓", tone: "text-[var(--ok)]", delay: "1.4s" },
];

export default function Loader({ label = "Loading" }: Props) {
  return (
    <div role="status" className="flex flex-col items-center gap-5">
      <div className="flex gap-3">
        {blocks.map((b) => (
          <span
            key={b.glyph}
            className={`loader-block bg-[var(--glass)] ${b.tone}`}
            style={{ animationDelay: b.delay }}
          >
            {b.glyph}
          </span>
        ))}
      </div>
      <p className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--glass)] px-5 py-2 text-sm font-medium text-[var(--mu)]">
        {label}
        <span aria-hidden="true" className="flex gap-1">
          <i className="loader-dot" style={{ animationDelay: "0s" }} />
          <i className="loader-dot" style={{ animationDelay: "0.15s" }} />
          <i className="loader-dot" style={{ animationDelay: "0.3s" }} />
        </span>
      </p>
    </div>
  );
}
