import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { wrapCompletionProvider } from "./workbench/editorHelp";
import { loader } from "@monaco-editor/react";

// Bundled, no CDN. JS/TS modes need their own worker, or Monaco logs "Missing requestHandler" errors.
self.MonacoEnvironment = {
  getWorker: (_id, label) => (label === "typescript" || label === "javascript" ? new tsWorker() : new editorWorker()),
};
// The 0.57 typings only declare a deprecated stub for the TS namespace, hence the cast.
type TsDefaults = { setDiagnosticsOptions(o: object): void; setCompilerOptions?(o: object): void; getCompilerOptions?(): object };
const ts = (monaco as unknown as { typescript?: Record<string, TsDefaults> }).typescript;
const DEFAULTS = ["javascriptDefaults", "typescriptDefaults"];

// Diagnostics are per language, not per model. Replay snippets are partial code, so the default is
// squiggles off. A practice editor (the `help` prop of EditorPane) turns them on while it is mounted;
// the count keeps two mounted editors, or a StrictMode remount, from switching them off too early.
let practiceEditors = 0;
function applyDiagnostics() {
  const on = practiceEditors > 0;
  for (const d of DEFAULTS) {
    ts?.[d]?.setDiagnosticsOptions({ noSemanticValidation: !on, noSyntaxValidation: !on, noSuggestionDiagnostics: true });
  }
  // JavaScript is only type-checked (for "Cannot find name") with checkJs.
  if (on) ts?.javascriptDefaults?.setCompilerOptions?.({ ...ts.javascriptDefaults.getCompilerOptions?.(), allowJs: true, checkJs: true, allowNonTsExtensions: true });
}
export function setPracticeDiagnostics(on: boolean) {
  practiceEditors = Math.max(0, practiceEditors + (on ? 1 : -1));
  applyDiagnostics();
}
applyDiagnostics();
// The language service registers its completion provider itself, and Monaco cannot edit another
// provider's items. Wrap it as it registers, so practice editors can add the docs to its suggestions.
// The wrapper does nothing unless a help editor is mounted.
const langs = monaco.languages;
const register = langs.registerCompletionItemProvider.bind(langs);
langs.registerCompletionItemProvider = (selector, provider) =>
  register(selector, selector === "javascript" || selector === "typescript" ? wrapCompletionProvider(provider, selector) : provider);
loader.config({ monaco });
