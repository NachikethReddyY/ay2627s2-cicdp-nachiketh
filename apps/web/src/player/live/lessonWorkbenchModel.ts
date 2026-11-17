import type { ShellState } from "../terminal/shellSocket.ts";
import { monacoLanguage, solutionFile } from "./checkModel.ts";

const LANGUAGE_LABELS = { javascript: "JavaScript", typescript: "TypeScript", python: "Python" } as const;

export function lessonFile(language: string | undefined) {
  const lang = monacoLanguage(language);
  return { fileName: solutionFile(lang), languageLabel: LANGUAGE_LABELS[lang] };
}

export const outputTail = (text: string, max: number) => (text.length > max ? text.slice(text.length - max) : text);

export const actionGuards = (o: { busy: boolean; checkBusy: boolean; lintBusy: boolean; code: string }) => ({
  run: !o.busy,
  check: !o.busy && !o.checkBusy,
  lint: !o.lintBusy && o.code.trim() !== "",
});

export function shellLine(s: ShellState): { text: string; retry?: boolean } | null {
  switch (s.kind) {
    case "connecting":
      return { text: "Starting your sandbox…" };
    case "reconnecting":
      return { text: "Reconnecting…" };
    case "exited":
      return { text: "[shell ended] Press Enter to start a new one" };
    case "closed":
      if (s.reason === "disabled") return { text: "The sandbox is off on this server" };
      if (s.reason === "signed_out") return { text: "Sign in to use the terminal" };
      if (s.reason === "replaced") return { text: "The terminal is open in another window", retry: true };
      return { text: s.message, retry: true };
    default:
      return null;
  }
}
