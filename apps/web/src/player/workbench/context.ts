import { createContext, useContext } from "react";

export const CODE_FONT = '"Geist Mono", ui-monospace, monospace';

export type WorkbenchContextValue = {
  /** Monaco theme name for the resolved light/dark theme. */
  monacoTheme: "learnslop-light" | "learnslop-dark";
  /** Report the editor caret so the status bar can show Ln/Col. */
  setCursor(c: { line: number; column: number } | null): void;
};

export const WorkbenchContext = createContext<WorkbenchContextValue>({
  monacoTheme: "learnslop-light",
  setCursor: () => {},
});

export const useWorkbench = () => useContext(WorkbenchContext);
