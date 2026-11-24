import type { ReactNode } from "react";
import { Dock, DockIcon } from "@/components/ui/dock";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type EditorDockItem = {
  id: string;
  label: string;
  art: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  dividerBefore?: boolean;
  onSelect(): void;
};

export default function EditorDock({ items }: { items: EditorDockItem[] }) {
  return (
    <TooltipProvider>
    <div role="group" aria-label="Workbench dock" className="editor-dock fixed bottom-3 left-1/2 z-[70] -translate-x-1/2 max-md:hidden">
      <Dock
        direction="bottom"
        iconSize={44}
        iconMagnification={60}
        iconDistance={100}
        className="mt-0 h-[56px] gap-1.5 rounded-[30px] border-transparent bg-white/20 px-2.5 py-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,.4),0_12px_32px_rgba(0,0,0,.16)] backdrop-blur-3xl"
      >
        {items.flatMap((item) => [
          ...(item.dividerBefore ? [<span key={`${item.id}-divider`} aria-hidden="true" className="mx-1.5 h-10 w-px self-center bg-[var(--line)]" />] : []),
          <DockIcon key={item.id} className="relative rounded-[22%]">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={item.label}
                        aria-pressed={item.pressed}
                        disabled={item.disabled}
                        onClick={item.onSelect}
                        className="absolute inset-0 overflow-hidden rounded-[22%] shadow-[inset_0_1px_0_rgba(255,255,255,.45),0_2px_6px_rgba(0,0,0,.25)] transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-95 disabled:opacity-40 disabled:grayscale"
                      />
                    }
                  >
                    {item.art}
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={12}>{item.label}</TooltipContent>
                </Tooltip>
                <span
                  aria-hidden="true"
                  className={cn("absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-white", !item.pressed && "invisible")}
                />
          </DockIcon>,
        ])}
      </Dock>
    </div>
    </TooltipProvider>
  );
}
