import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { IDisposable, Uri, editor as MonacoEditor } from "monaco-editor";
import type { SeekResult } from "@learnquest/player-core";
import { setPracticeDiagnostics } from "./monaco";
import Loader from "../components/Loader";
import { defineWorkbenchThemes } from "./workbench/monacoThemes";
import { explainMarker } from "./workbench/editorHelp";
import type { WorkbenchProblem } from "./workbench/context";

export type EditorHandle = { show(r: SeekResult): void; focus(): void };

const langOf = (p: string) => (/\.tsx?$/.test(p) ? "typescript" : /\.jsx?$/.test(p) ? "javascript" : "plaintext");

type Props = {
  ref?: Ref<EditorHandle>;
  transportRef: RefObject<HTMLButtonElement | null>;
  viewPath?: string; // file the user picked; falls back to the replay's active file
  overlay?: ReactNode;
  edit?: { value: string; language: string; onChange(v: string): void }; // practice: the learner types here
  theme?: string; // workbench themes ("learnslop-light" / "learnslop-dark"); default "vs"
  fontFamily?: string;
  onCursor?(line: number, column: number): void; // caret moves, for a status bar
  onSelection?(selection: { startLine: number; endLine: number; text: string } | null): void;
  onProblems?(problems: WorkbenchProblem[]): void;
  problemFileName?: string;
  wordWrap?: boolean;
  help?: (monaco: Parameters<OnMount>[1], editor: Parameters<OnMount>[0]) => IDisposable; // practice: hovers, completion docs, squiggles
};

export default function EditorPane({ ref, transportRef, viewPath, overlay, edit, theme, fontFamily, onCursor, onSelection, onProblems, problemFileName, wordWrap = false, help }: Props) {
  const [active, setActive] = useState("");
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const caretRef = useRef<ReturnType<Parameters<OnMount>[0]["createDecorationsCollection"]> | null>(null);
  const lastRef = useRef<SeekResult | null>(null);
  const viewRef = useRef(viewPath);
  const cursorRef = useRef(onCursor);
  cursorRef.current = onCursor;
  const selectionRef = useRef(onSelection);
  selectionRef.current = onSelection;
  const helpRef = useRef(help);
  helpRef.current = help;
  const problemsRef = useRef(onProblems);
  problemsRef.current = onProblems;
  const problemFileRef = useRef(problemFileName);
  problemFileRef.current = problemFileName;
  const language = edit?.language ?? langOf(viewPath ?? active);
  const helpOn = !!help;
  const [mounted, setMounted] = useState<{ ed: Parameters<OnMount>[0]; monaco: Parameters<OnMount>[1] } | null>(null);

  // Diagnostics on while a help editor is mounted; the replay defaults come back on unmount.
  useEffect(() => {
    if (!helpOn) return;
    setPracticeDiagnostics(true);
    return () => setPracticeDiagnostics(false);
  }, [helpOn]);
  useEffect(() => {
    if (!helpOn || !mounted) return;
    const d = helpRef.current?.(mounted.monaco, mounted.ed);
    return () => d?.dispose();
  }, [helpOn, mounted, language]);

  const apply = useCallback((r: SeekResult) => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    if (!ed || !model) return;
    const shown = viewRef.current ?? r.activePath;
    const text = r.files[shown] ?? "";
    if (model.getValue() !== text) model.setValue(text);
    if (r.lastEdit?.path === shown) {
      const pos = model.getPositionAt(r.lastEdit.offset);
      ed.setPosition(pos);
      ed.revealPositionInCenterIfOutsideViewport(pos);
      const m = monacoRef.current;
      caretRef.current?.set(
        m
          ? [{ range: new m.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), options: { beforeContentClassName: "lq-caret", showIfCollapsed: true } }]
          : [],
      );
    } else caretRef.current?.clear();
  }, []);

  useEffect(() => {
    viewRef.current = viewPath;
    if (lastRef.current) apply(lastRef.current);
  }, [viewPath, apply]);

  useImperativeHandle(ref, () => ({
    show(r) {
      lastRef.current = r;
      setActive(r.activePath);
      apply(r);
    },
    focus: () => editorRef.current?.focus(),
  }));

  const onMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    caretRef.current = ed.createDecorationsCollection();
    ed.onDidChangeCursorPosition((e) => cursorRef.current?.(e.position.lineNumber, e.position.column));
    if (edit) {
      const syncProblems = () => {
        const model = ed.getModel();
        if (!model) return;
        const current = monaco.editor.getModelMarkers({ resource: model.uri }) as MonacoEditor.IMarker[];
        problemsRef.current?.(current
          .filter((marker) => marker.severity === monaco.MarkerSeverity.Error || marker.severity === monaco.MarkerSeverity.Warning)
          .map((marker) => {
            const missingName = /^Cannot find name '([^']+)'/.exec(marker.message)?.[1];
            const missingProperty = /^Property '([^']+)' does not exist/.exec(marker.message)?.[1];
            const friendly = explainMarker(marker.message);
            const title = missingName ? `“${missingName}” has not been defined` : missingProperty ? `“${missingProperty}” is not available here` : friendly ? "Check this line" : "This code needs a change";
            const explanation = missingName
              ? `I can’t find “${missingName}” in this file. Check its spelling or define it before this line.`
              : missingProperty
                ? `This value doesn’t have a “${missingProperty}” property. Check that you are using the right value or property name.`
                : friendly ?? "There’s something in this line that the editor can’t understand yet. Check this line and the one before it.";
            const contextStart = Math.max(1, marker.startLineNumber - 2);
            const codeContext = model.getValue().split("\n").slice(contextStart - 1, marker.startLineNumber + 2)
              .map((line, index) => `${contextStart + index === marker.startLineNumber ? ">" : " "} ${contextStart + index}: ${line}`).join("\n");
            return {
              fileName: problemFileRef.current || model.uri.path.split("/").pop() || "Current file",
              line: marker.startLineNumber,
              severity: marker.severity === monaco.MarkerSeverity.Error ? "error" as const : "warning" as const,
              title,
              explanation,
              diagnostic: marker.message,
              codeContext,
            };
          }));
      };
      const markers = monaco.editor.onDidChangeMarkers((resources: readonly Uri[]) => {
        const model = ed.getModel();
        if (model && resources.some((uri) => uri.toString() === model.uri.toString())) syncProblems();
      });
      syncProblems();
      ed.onDidDispose(() => markers.dispose());
    }
    ed.onDidChangeCursorSelection(({ selection }) => {
      if (selection.isEmpty()) {
        selectionRef.current?.(null);
        return;
      }
      const model = ed.getModel();
      if (!model) return;
      selectionRef.current?.({
        startLine: selection.startLineNumber,
        endLine: selection.endLineNumber,
        text: model.getValueInRange(selection),
      });
    });
    ed.addCommand(
      monaco.KeyCode.Escape,
      () => {
        (document.activeElement as HTMLElement | null)?.blur();
        transportRef.current?.focus();
      },
      "!findWidgetVisible",
    );
    if (lastRef.current) apply(lastRef.current);
    setMounted({ ed, monaco });
  };

  return (
    <div className="relative h-[65dvh] min-w-0 flex-none lg:h-auto lg:min-h-0 lg:flex-1">
      <Editor
        path={edit && problemFileName ? `file:///workspace/${problemFileName}` : undefined}
        loading={<div className="grid h-full place-items-center"><Loader label="Opening the editor" /></div>}
        language={language}
        value={edit?.value}
        onChange={edit && ((v) => edit.onChange(v ?? ""))}
        theme={theme ?? "vs"}
        beforeMount={theme ? (m) => defineWorkbenchThemes(m) : undefined}
        onMount={onMount}
        options={{
          readOnly: !edit,
          ariaLabel: edit ? "Your code. Press Escape to leave the editor." : "Code replay, read only. Press Escape to leave the editor.",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: wordWrap ? "on" : "off",
          suggestLineHeight: 32,
          fontSize: 14,
          ...(fontFamily && {
            // Main.dc.html: 13 px code on 22 px rows, 8 px above the first line, scrollbars hidden, scrolling kept.
            fontFamily,
            fontSize: 13,
            lineHeight: 22,
            lineNumbersMinChars: 3,
            lineDecorationsWidth: 10,
            folding: false,
            glyphMargin: false,
            renderLineHighlight: "all" as const,
            scrollbar: { vertical: "hidden" as const, horizontal: "hidden" as const }, // the board hides the scrollbar (nosb)
          }),
          padding: { top: fontFamily ? 8 : 0, bottom: edit ? 16 : 140 }, // room for the replay's floating controls
          hover: { enabled: help ? "on" : "off" },
          lightbulb: { enabled: "off" as never }, // no quick fixes: errors are explained, not rewritten
          occurrencesHighlight: "off",
        }}
      />
      {overlay}
    </div>
  );
}
