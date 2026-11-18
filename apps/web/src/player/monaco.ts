import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { wrapCompletionProvider } from "./workbench/editorHelp";
import { loader } from "@monaco-editor/react";

self.MonacoEnvironment = {
  getWorker: (_id, label) => (label === "typescript" || label === "javascript" ? new tsWorker() : new editorWorker()),
};
type TsDefaults = {
  setDiagnosticsOptions(o: object): void;
  setCompilerOptions?(o: object): void;
  getCompilerOptions?(): object;
  addExtraLib?(content: string, filePath?: string): { dispose(): void };
  setModeConfiguration?(o: object): void;
  modeConfiguration?: object;
};
const ts = (monaco as unknown as { typescript?: Record<string, TsDefaults> }).typescript;
const DEFAULTS = ["javascriptDefaults", "typescriptDefaults"];

for (const d of DEFAULTS) ts?.[d]?.setModeConfiguration?.({ ...ts[d].modeConfiguration, codeActions: false });
ts?.javascriptDefaults?.setCompilerOptions?.({
  ...ts.javascriptDefaults.getCompilerOptions?.(),
  allowJs: true,
  checkJs: true,
  allowNonTsExtensions: true,
  lib: ["es2022", "dom"],
});
ts?.javascriptDefaults?.addExtraLib?.(
  `type Task = { id: number; title: string; completed: boolean };
declare const console: { log(...data: unknown[]): void; info(...data: unknown[]): void; warn(...data: unknown[]): void; error(...data: unknown[]): void; };
declare const require: {
  (id: "./taskStore"): {
    listTasks(): Promise<Task[]>;
    addTask(title: string): Promise<Task>;
    completeTask(id: number): Promise<Task | null>;
    removeTask(id: number): Promise<boolean>;
  };
  (id: string): any;
};
declare const __dirname: string;
declare const module: { exports: any };
declare const process: { exitCode?: number };
declare module "node:readline/promises" {
  export function createInterface(options: { input: unknown; output: unknown }): {
    question(prompt: string): Promise<string>;
    close(): void;
  };
}
declare module "node:process" { export const stdin: unknown; export const stdout: unknown; }
declare module "node:fs/promises" {
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function writeFile(path: string, data: string): Promise<void>;
}
declare module "node:path" { export function join(...parts: string[]): string; }
declare module "fs" { export function readFileSync(fd: number | string, encoding: "utf8"): string; }
declare module "node:fs" { export function readFileSync(fd: number | string, encoding: "utf8"): string; }`,
  "file:///learnslop-globals.d.ts",
);
ts?.javascriptDefaults?.addExtraLib?.(
  `export type Task = { id: number; title: string; completed: boolean };
export function listTasks(): Promise<Task[]>;
export function addTask(title: string): Promise<Task>;
export function completeTask(id: number): Promise<Task | null>;
export function removeTask(id: number): Promise<boolean>;`,
  "file:///workspace/task-tracker/src/taskStore.d.ts",
);

let practiceEditors = 0;
function applyDiagnostics() {
  const on = practiceEditors > 0;
  for (const d of DEFAULTS) {
    ts?.[d]?.setDiagnosticsOptions({
      noSemanticValidation: !on,
      noSyntaxValidation: !on,
      noSuggestionDiagnostics: true,
      diagnosticCodesToIgnore: d === "javascriptDefaults" ? [2322] : [],
    });
  }
}
export function setPracticeDiagnostics(on: boolean) {
  practiceEditors = Math.max(0, practiceEditors + (on ? 1 : -1));
  applyDiagnostics();
}
applyDiagnostics();

const langs = monaco.languages as typeof monaco.languages & { __lqWrapped?: boolean };
if (!langs.__lqWrapped) {
  langs.__lqWrapped = true;
  const register = langs.registerCompletionItemProvider.bind(langs);
  langs.registerCompletionItemProvider = (selector, provider) =>
    register(selector, selector === "javascript" || selector === "typescript" ? wrapCompletionProvider(provider, selector) : provider);
}
loader.config({ monaco });
