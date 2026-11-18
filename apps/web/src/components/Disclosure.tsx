import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="disc" data-open={open}>
      <button type="button" className="disc-trigger" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        {label}
        <ChevronDown size={16} strokeWidth={2.25} aria-hidden />
      </button>
      <div className="disc-panel" id={panelId} inert={!open}>
        <div className="disc-inner">{children}</div>
      </div>
    </div>
  );
}
