import type { ComponentProps } from "react";
import EditorPane from "../EditorPane";
import { CODE_FONT, useWorkbench } from "./context";

type Props = Omit<ComponentProps<typeof EditorPane>, "theme" | "fontFamily" | "onCursor">;

// EditorPane with the workbench's theme and code font, reporting its caret to the status bar.
export default function WorkbenchEditor(props: Props) {
  const { monacoTheme, setCursor } = useWorkbench();
  return <EditorPane {...props} theme={monacoTheme} fontFamily={CODE_FONT} onCursor={(line, column) => setCursor({ line, column })} />;
}
