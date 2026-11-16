import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A button that opens a panel with an animated height. The panel stays mounted when closed so the
 * close animation can run; `inert` keeps its content out of the tab order and the accessibility tree.
 * Styled by `.disc` in pages/changelog.css, and the transition is switched off by the reduced-motion rule there.
 */
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
