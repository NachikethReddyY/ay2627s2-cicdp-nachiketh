import type { ComponentProps } from "react";
import EditorPane from "../EditorPane";
import { CODE_FONT, useWorkbench } from "./context";
import { registerEditorHelp } from "./editorHelp";

const HELP_LANGUAGES = new Set(["javascript", "typescript", "python"]);

type Props = Omit<ComponentProps<typeof EditorPane>, "theme" | "fontFamily" | "onCursor" | "onSelection" | "help">;

export default function WorkbenchEditor(props: Props) {
  const { monacoTheme, wordWrap, fileName, setCursor, setSelection, setProblems, openDoc } = useWorkbench();
  const language = props.edit?.language;
  return (
    <EditorPane
      {...props}
      theme={monacoTheme}
      fontFamily={CODE_FONT}
      onCursor={(line, column) => setCursor({ line, column })}
      onSelection={setSelection}
      onProblems={setProblems}
      problemFileName={fileName}
      wordWrap={wordWrap}
      help={language && HELP_LANGUAGES.has(language) ? (monaco, ed) => registerEditorHelp(monaco, language, openDoc, ed) : undefined}
    />
  );
}
