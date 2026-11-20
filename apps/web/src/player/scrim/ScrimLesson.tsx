import { useState, type ReactNode } from "react";
import LessonWorkbench from "../live/LessonWorkbench";
import type { Lesson, Part } from "../live/types";
import ScrimWatch from "./ScrimWatch";

type ScrimPart = Extract<Part, { kind: "scrim" }>;

export default function ScrimLesson({ lessonId, title, part, steps, media, next }: { lessonId: string; title: string; part: ScrimPart; steps: Lesson["steps"]; media: Lesson["media"]; next: ReactNode }) {
  const [phase, setPhase] = useState<"watch" | "lab">("watch");
  if (phase === "lab") return <LessonWorkbench lessonId={lessonId} title={title} part={part.lab} next={next} video={false} />;
  return <ScrimWatch lessonId={lessonId} title={title} part={part} steps={steps} media={media} onLab={() => setPhase("lab")} />;
}
