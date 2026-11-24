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
  onSelect(): void;
};

export default function EditorDock({ items }: { items: EditorDockItem[] }) {
  return (
    <TooltipProvider>
      <div role="group" aria-label="Workbench dock" className="editor-dock fixed bottom-3 left-1/2 z-[70] -translate-x-1/2 max-md:hidden">
        <Dock
          iconSize={42}
          disableMagnification
          className="mt-0 h-14 gap-2 rounded-full border-white/20 bg-black/30 px-2.5 py-1.5 backdrop-blur-2xl"
        >
          {items.map((item) => (
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
                      className="absolute inset-0 overflow-hidden rounded-[22%] shadow-[0_2px_6px_rgba(0,0,0,.25)] transition-[filter,transform] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-95 disabled:opacity-40 disabled:grayscale"
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
            </DockIcon>
          ))}
        </Dock>
      </div>
    </TooltipProvider>
  );
}
