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
  monacoTheme: "learnslop-light" | "learnslop-dark" | "learnslop-workbench-dark";
  wordWrap: boolean;
  setWordWrap(value: boolean): void;
  fileName: string;
  setCursor(c: { line: number; column: number } | null): void;
  setSelection(s: { startLine: number; endLine: number; text: string } | null): void;
  setProblems(problems: WorkbenchProblem[]): void;
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
