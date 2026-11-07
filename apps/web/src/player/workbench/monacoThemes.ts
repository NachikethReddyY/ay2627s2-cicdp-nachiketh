import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

// Colours come from the workbench tokens (workbench.css) and the plan's syntax palette.
type Palette = {
  base: "vs" | "vs-dark";
  tx: string; code: string; cur: string; numdim: string; sel: string; line: string;
  keyword: string; string: string; type: string; comment: string; number: string;
};

const LIGHT: Palette = {
  base: "vs", tx: "#1c1c1e", code: "#FFFFFF", cur: "#fff6cf", numdim: "#b4b8c0", sel: "#2f5fd624", line: "#D7D6D6",
  keyword: "9b2393", string: "c41a16", type: "0b4f79", comment: "5d6c79", number: "1c00cf",
};
const DARK: Palette = {
  base: "vs-dark", tx: "#ececec", code: "#262626", cur: "#34322a", numdim: "#5f5f5f", sel: "#7896ff38", line: "#3a3a3a",
  keyword: "ff7ab2", string: "ff8170", type: "6bdfff", comment: "8a919e", number: "d9c97c",
};

function build(p: Palette): editor.IStandaloneThemeData {
  return {
    base: p.base,
    inherit: true,
    rules: [
      { token: "keyword", foreground: p.keyword },
      { token: "string", foreground: p.string },
      { token: "type", foreground: p.type },
      { token: "type.identifier", foreground: p.type },
      { token: "comment", foreground: p.comment, fontStyle: "italic" },
      { token: "number", foreground: p.number },
    ],
    colors: {
      "editor.background": p.code,
      "editor.foreground": p.tx,
      "editor.lineHighlightBackground": p.cur,
      "editor.selectionBackground": p.sel,
      "editorLineNumber.foreground": p.numdim,
      "editorLineNumber.activeForeground": p.tx,
      "editorIndentGuide.background1": p.line,
    },
  };
}

export function defineWorkbenchThemes(monaco: Monaco): void {
  monaco.editor.defineTheme("learnslop-light", build(LIGHT));
  monaco.editor.defineTheme("learnslop-dark", build(DARK));
}
