import { createContext, useContext } from "react";

export const CODE_FONT = '"Geist Mono", ui-monospace, monospace';

export type WorkbenchProblem = {
  fileName: string;
  line: number;
  severity: "error" | "warning";
  title: string;
  explanation: string;
  diagnostic?: string;
  codeContext?: string;
};

export type WorkbenchContextValue = {
  /** Monaco theme name for the resolved light/dark theme. */
  monacoTheme: "learnslop-light" | "learnslop-dark";
  wordWrap: boolean;
  setWordWrap(value: boolean): void;
  fileName: string;
  /** Report the editor caret so the status bar can show Ln/Col. */
  setCursor(c: { line: number; column: number } | null): void;
  /** Report a non-empty code selection to the guide composer. */
  setSelection(s: { startLine: number; endLine: number; text: string } | null): void;
  setProblems(problems: WorkbenchProblem[]): void;
  /** Open a docs entry in the utility area (the editor hover's "Open in Docs"). */
  openDoc(id: string): void;
};

export const WorkbenchContext = createContext<WorkbenchContextValue>({
  monacoTheme: "learnslop-light",
  wordWrap: false,
  setWordWrap: () => {},
  fileName: "",
  setCursor: () => {},
  setSelection: () => {},
  setProblems: () => {},
  openDoc: () => {},
});

export const useWorkbench = () => useContext(WorkbenchContext);
