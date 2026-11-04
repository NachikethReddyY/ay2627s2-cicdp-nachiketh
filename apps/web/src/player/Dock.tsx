import type { ReactNode } from "react";
import { FOCUS } from "./ui";

export type DockItem = { id: string; label: string; icon: ReactNode; tone: string; running?: boolean; pressed?: boolean; onClick(): void };

/** macOS-style dock: icon-only buttons, name shown as a tooltip on hover and keyboard focus. */
export default function Dock({ items, hidden }: { items: DockItem[]; hidden: boolean }) {
  return (
    <div
      role="group"
      aria-label="Dock"
      className={`absolute bottom-3 left-1/2 z-[2000] -translate-x-1/2 gap-2 rounded-2xl border-[3px] border-ink bg-white/90 p-1.5 shadow-[4px_4px_0_var(--color-ink)] ${hidden ? "hidden" : "hidden lg:flex"}`}
    >
      {items.map((it) => (
        <div key={it.id} className="group/item relative flex flex-col items-center">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-full mb-2 rounded-lg border-2 border-ink bg-ink px-2 py-0.5 text-xs font-extrabold whitespace-nowrap text-white opacity-0 group-hover/item:opacity-100 group-has-focus-visible/item:opacity-100"
          >
            {it.label}
          </span>
          <button
            type="button"
            aria-label={it.label}
            aria-pressed={it.pressed}
            data-dock-id={it.id}
            onClick={it.onClick}
            className={`grid size-11 place-items-center rounded-xl border-[3px] border-ink transition-[width,height,scale] motion-reduce:transition-none motion-safe:hover:size-14 motion-safe:active:scale-90 ${it.tone} ${FOCUS}`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 fill-none stroke-ink stroke-2 [stroke-linecap:round] [stroke-linejoin:round]">
              {it.icon}
            </svg>
          </button>
          <span aria-hidden="true" className={`mt-0.5 size-1.5 rounded-full ${it.running ? "bg-ink" : ""}`} />
        </div>
      ))}
    </div>
  );
}
