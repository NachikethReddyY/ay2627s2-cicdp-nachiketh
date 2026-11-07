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
type TsDefaults = {
  setDiagnosticsOptions(o: object): void;
  setCompilerOptions?(o: object): void;
  getCompilerOptions?(): object;
  setModeConfiguration?(o: object): void;
  modeConfiguration?: object;
};
const ts = (monaco as unknown as { typescript?: Record<string, TsDefaults> }).typescript;
const DEFAULTS = ["javascriptDefaults", "typescriptDefaults"];

// No quick fixes anywhere: error hovers explain, they never rewrite code. Must run before the language
// mode loads lazily (monaco-editor 0.57 tsMode registers its CodeActionAdaptor from this configuration).
for (const d of DEFAULTS) ts?.[d]?.setModeConfiguration?.({ ...ts[d].modeConfiguration, codeActions: false });
// JavaScript is only type-checked (for "Cannot find name") with checkJs. Set once: it changes nothing
// while semantic validation is off, and re-setting it would restart the worker.
ts?.javascriptDefaults?.setCompilerOptions?.({ ...ts.javascriptDefaults.getCompilerOptions?.(), allowJs: true, checkJs: true, allowNonTsExtensions: true });

// Diagnostics are per language, not per model. Replay snippets are partial code, so the default is
// squiggles off. A practice editor (the `help` prop of EditorPane) turns them on while it is mounted;
// the count keeps two mounted editors, or a StrictMode remount, from switching them off too early.
let practiceEditors = 0;
function applyDiagnostics() {
  const on = practiceEditors > 0;
  for (const d of DEFAULTS) {
    ts?.[d]?.setDiagnosticsOptions({
      noSemanticValidation: !on,
      noSyntaxValidation: !on,
      noSuggestionDiagnostics: true,
      // Raw type errors ("Type 'x' is not assignable") are noise for a learner in plain JavaScript.
      diagnosticCodesToIgnore: d === "javascriptDefaults" ? [2322] : [],
    });
  }
}
export function setPracticeDiagnostics(on: boolean) {
  practiceEditors = Math.max(0, practiceEditors + (on ? 1 : -1));
  applyDiagnostics();
}
applyDiagnostics();

// The language service registers its completion provider itself, and Monaco cannot edit another
// provider's items. Wrap it as it registers (depends on monaco-editor 0.57's tsMode calling
// languages.registerCompletionItemProvider with the language id), so practice editors can add the docs
// to its suggestions. The wrapper does nothing unless a help editor is mounted. Flagged so an HMR
// reload of this module does not wrap twice.
const langs = monaco.languages as typeof monaco.languages & { __lqWrapped?: boolean };
if (!langs.__lqWrapped) {
  langs.__lqWrapped = true;
  const register = langs.registerCompletionItemProvider.bind(langs);
  langs.registerCompletionItemProvider = (selector, provider) =>
    register(selector, selector === "javascript" || selector === "typescript" ? wrapCompletionProvider(provider, selector) : provider);
}
loader.config({ monaco });
