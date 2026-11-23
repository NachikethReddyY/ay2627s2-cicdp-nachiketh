import { usePostHog } from "@posthog/react";
import type { MouseEvent } from "react";
import type { RouterOutputs } from "../../lib/trpc";
import type { Lesson } from "./types";

const lessonEntrySources = ["course_cta", "lesson_node", "lesson_detail", "home_continue", "home_resume", "lesson_end"] as const;
type LessonEntrySource = typeof lessonEntrySources[number];

declare module "@tanstack/react-router" {
  interface HistoryState {
    lessonEntrySource?: LessonEntrySource;
  }
}

export function useLessonAnalytics() {
  const posthog = usePostHog();
  const completed = (kind: Lesson["kind"]) => posthog?.capture("lesson_completed", { lesson_kind: kind });
  return {
    started(kind: Lesson["kind"], entry: LessonEntrySource | undefined) {
      const source = lessonEntrySources.find((item) => item === entry) ?? "direct";
      posthog?.capture("lesson_started", { lesson_kind: kind, source });
    },
    answered(kind: Lesson["kind"], stepKind: "mcq" | "cloze", position: number, result: RouterOutputs["steps"]["attempt"]) {
      const properties = { lesson_kind: kind, step_kind: stepKind, step_position: position, is_correct: result.correct };
      posthog?.capture("lesson_step_answered", properties);
      posthog?.logger.info("lesson step answered", properties);
      if (result.lessonJustCompleted) completed(kind);
    },
    completed,
  };
}

export function isInAppLinkClick(e: MouseEvent<HTMLAnchorElement>) {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export type ContinueAction = "lesson" | "assess" | "review" | "course";

export function useContinueAnalytics(source: "home_continue" | "lesson_end") {
  const posthog = usePostHog();
  return (action: ContinueAction) => posthog?.capture("continue_clicked", { source, action });
}
