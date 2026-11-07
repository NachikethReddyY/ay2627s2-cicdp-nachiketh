import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { SeekResult } from "@learnquest/player-core";
import "./monaco";
import Loader from "../components/Loader";
import { defineWorkbenchThemes } from "./workbench/monacoThemes";

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
};

export default function EditorPane({ ref, transportRef, viewPath, overlay, edit, theme, fontFamily }: Props) {
  const [active, setActive] = useState("");
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const caretRef = useRef<ReturnType<Parameters<OnMount>[0]["createDecorationsCollection"]> | null>(null);
  const lastRef = useRef<SeekResult | null>(null);
  const viewRef = useRef(viewPath);

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
    ed.addCommand(
      monaco.KeyCode.Escape,
      () => {
        (document.activeElement as HTMLElement | null)?.blur();
        transportRef.current?.focus();
      },
      "!findWidgetVisible",
    );
    if (lastRef.current) apply(lastRef.current);
  };

  return (
    <div className="relative h-[65dvh] min-w-0 flex-none lg:h-auto lg:min-h-0 lg:flex-1">
      <Editor
        loading={<div className="grid h-full place-items-center"><Loader label="Opening the editor" /></div>}
        language={edit?.language ?? langOf(viewPath ?? active)}
        value={edit?.value}
        onChange={edit && ((v) => edit.onChange(v ?? ""))}
        theme={theme ?? "vs"}
        beforeMount={theme ? (m) => defineWorkbenchThemes(m as never) : undefined}
        onMount={onMount}
        options={{
          readOnly: !edit,
          ariaLabel: edit ? "Your code. Press Escape to leave the editor." : "Code replay, read only. Press Escape to leave the editor.",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fontSize: 14,
          ...(fontFamily && { fontFamily, lineHeight: 22 }),
          padding: { bottom: edit ? 16 : 140 }, // room for the replay's floating controls
          hover: { enabled: "off" },
          occurrencesHighlight: "off",
        }}
      />
      {overlay}
    </div>
  );
}
