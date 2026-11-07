import type { ReactNode, Ref } from "react";
import FileBadge from "./FileBadge";

type Toggle = { pressed: boolean; onClick(): void; label: string; ref?: Ref<HTMLButtonElement> };

type Props = {
  title: string;
  fileName: string;
  nav: Toggle;
  terminal: Toggle;
  util: Toggle;
  /** Slot before the actions, for the palette's search button (Task 4). */
  tools?: ReactNode;
  /** Run / Stop / Check / Next. */
  actions: ReactNode;
};

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d={d} />
  </svg>
);

function ToggleButton({ t, d }: { t: Toggle; d: string }) {
  return (
    <button ref={t.ref} type="button" className="wb-tb" aria-label={t.label} title={t.label} aria-pressed={t.pressed} onClick={t.onClick}>
      <Icon d={d} />
    </button>
  );
}

// The project mark from the design: a rounded square with a sprout.
const Mark = ({ size }: { size: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" className="flex-none">
    <rect x="1" y="1" width="14" height="14" rx="4" fill="#3d79e0" />
    <path
      transform="scale(.667)"
      d="M12 18v-6m0 0c0-3 2-5 5-5 0 3-2 5-5 5zm0 0c0-2-1.5-3.5-4-3.5 0 2 1.5 3.5 4 3.5z"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function Toolbar({ title, fileName, nav, terminal, util, tools, actions }: Props) {
  return (
    <header className="flex flex-none flex-col border-b border-[var(--line)] bg-[var(--tbar)]">
      <div className="flex h-12 flex-none items-center gap-2 px-2 sm:gap-3 sm:px-3">
        <span className="wb-pill">
          <ToggleButton t={nav} d="M9 4v16" />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
          <a href="/" className="flex flex-none items-center gap-1.5 rounded text-[13px] font-semibold" aria-label="LearnSlop home">
            <Mark size={18} />
            <span className="max-sm:hidden">LearnSlop</span>
          </a>
          <span aria-hidden="true" className="text-[var(--mu)] max-sm:hidden">/</span>
          <h1 className="min-w-0 truncate text-[13px] font-medium">{title}</h1>
        </div>
        {tools}
        <div className="flex flex-none items-center gap-1">{actions}</div>
        <span className="wb-pill">
          <ToggleButton t={terminal} d="M3 14.5h18" />
          <ToggleButton t={util} d="M17 4v16M3 10h14" />
        </span>
      </div>
      <nav aria-label="File path" className="flex h-8 flex-none items-center overflow-hidden border-t border-[var(--line)] px-3.5 text-[var(--mu)]">
        <ol className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          <li className="flex items-center gap-1.5">
            <Mark size={15} />
            learnslop
          </li>
          <li aria-hidden="true">›</li>
          <li className="truncate">{title}</li>
          <li aria-hidden="true">›</li>
          <li className="wb-mono flex items-center gap-1.5 text-[var(--tx)]" aria-current="page">
            <FileBadge path={fileName} />
            {fileName}
          </li>
        </ol>
      </nav>
    </header>
  );
}
