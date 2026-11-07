import type { ComponentProps } from "react";
import EditorPane from "../EditorPane";
import { CODE_FONT, useWorkbench } from "./context";
import { registerEditorHelp } from "./editorHelp";

type Props = Omit<ComponentProps<typeof EditorPane>, "theme" | "fontFamily" | "onCursor" | "help">;

// EditorPane with the workbench's theme and code font, reporting its caret to the status bar.
// A practice editor (one with `edit`) also gets docs hovers, completion details and error explanations.
export default function WorkbenchEditor(props: Props) {
  const { monacoTheme, setCursor, openDoc } = useWorkbench();
  const language = props.edit?.language;
  return (
    <EditorPane
      {...props}
      theme={monacoTheme}
      fontFamily={CODE_FONT}
      onCursor={(line, column) => setCursor({ line, column })}
      help={language ? (monaco, ed) => registerEditorHelp(monaco, language, openDoc, ed) : undefined}
    />
  );
}
