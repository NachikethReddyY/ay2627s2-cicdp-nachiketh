import type { LucideIcon } from "lucide-react";
import { Dock, DockIcon } from "@/components/ui/dock";
import { cn } from "@/lib/utils";

export type EditorDockItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  pressed?: boolean;
  disabled?: boolean;
  onSelect(): void;
};

/** Magnifying icon dock at the bottom of the test editor. Hidden on narrow screens. */
export default function EditorDock({ items }: { items: EditorDockItem[] }) {
  return (
    <div className="fixed bottom-9 left-1/2 z-[70] -translate-x-1/2 max-md:hidden">
      <Dock
        direction="middle"
        className={cn(
          "border-[var(--glass-line)] bg-[var(--glass)] shadow-[0_8px_24px_rgba(20,30,70,.18)]",
        )}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DockIcon key={item.id}>
              <button
                type="button"
                aria-label={item.label}
                title={item.label}
                aria-pressed={item.pressed}
                disabled={item.disabled}
                onClick={item.onSelect}
                className="grid size-full place-items-center rounded-xl bg-transparent text-[var(--tx)] hover:bg-[var(--hov)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ac)] disabled:opacity-40"
              >
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </DockIcon>
          );
        })}
      </Dock>
    </div>
  );
}
