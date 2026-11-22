import type { ShellState } from "../terminal/shellSocket.ts";
import { monacoLanguage, solutionFile } from "./checkModel.ts";

const LANGUAGE_LABELS = { javascript: "JavaScript", typescript: "TypeScript", python: "Python" } as const;

export function lessonFile(language: string | undefined) {
  const lang = monacoLanguage(language);
  return { fileName: solutionFile(lang), languageLabel: LANGUAGE_LABELS[lang] };
}

export const outputTail = (text: string, max: number) => (text.length > max ? text.slice(text.length - max) : text);

export const actionGuards = (o: { busy: boolean; checkBusy: boolean; lintBusy: boolean; code: string }) => ({
  run: !o.busy && o.code.trim() !== "",
  check: !o.busy && !o.checkBusy && o.code.trim() !== "",
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

export function practiceMedia(media: ReadonlyArray<{ stepId: string | null; segment: number | null; url: string }>) {
  const narration = media.find((item) => item.stepId === null && item.segment === null);
  if (!narration) return undefined;
  const type = narration.url.split("?")[0].endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  return { src: narration.url, type };
}
