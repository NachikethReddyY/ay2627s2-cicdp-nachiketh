import { useState, type ReactNode } from "react";
import { trpc } from "../../lib/trpc";
import LessonWorkbench from "../live/LessonWorkbench";
import type { Lesson, Part } from "../live/types";
import { resumeTime } from "./scrimModel";
import ScrimWatch from "./ScrimWatch";

type ScrimPart = Extract<Part, { kind: "scrim" }>;

export default function ScrimLesson({ lessonId, title, part, steps, media, next }: { lessonId: string; title: string; part: ScrimPart; steps: Lesson["steps"]; media: Lesson["media"]; next: ReactNode }) {
  const [phase, setPhase] = useState<"watch" | "lab">("watch");
  const [loadedPart, setLoadedPart] = useState(part);
  const [loadedSteps, setLoadedSteps] = useState(steps);
  const [loadedMedia, setLoadedMedia] = useState(media);
  const [revision, setRevision] = useState(0);
  const [resumeAt, setResumeAt] = useState(() => resumeTime(part.segments, steps, part.started));
  const [pendingGate, setPendingGate] = useState<{ stepId: string; at: number } | null>(null);
  const [loadError, setLoadError] = useState("");
  const loadMore = async (stepId: string, at: number) => {
    setPendingGate({ stepId, at });
    setLoadError("");
    try {
      const [step, more] = await Promise.all([
        trpc.steps.get.query({ id: stepId }),
        trpc.lessons.scrimMore.query({ id: lessonId, from: Math.max(0, loadedPart.segments.length - 1) }),
      ]);
      const segments = [...loadedPart.segments.slice(0, more.from), ...more.segments];
      const mediaBySegment = new Map([...loadedMedia, ...more.media].map((item) => [String(item.stepId) + ":" + String(item.segment), item]));
      setLoadedPart({ ...loadedPart, segments });
      setLoadedSteps(loadedSteps.map((item) => item.id === stepId ? { ...item, state: step.state } : item));
      setLoadedMedia([...mediaBySegment.values()].sort((a, b) => (a.segment ?? -1) - (b.segment ?? -1)));
      setResumeAt(at);
      setRevision((value) => value + 1);
      setPendingGate(null);
    } catch {
      setPendingGate({ stepId, at });
      setLoadError("The next part could not be loaded.");
    }
  };
  if (phase === "lab") return <LessonWorkbench lessonId={lessonId} title={title} part={loadedPart.lab} next={next} video={false} />;
  return (
    <>
      {loadError && <div role="alert" className="p-3 text-center">{loadError} <button type="button" className="pill px-3 py-1 text-sm" onClick={() => pendingGate && void loadMore(pendingGate.stepId, pendingGate.at)}>Retry</button></div>}
      <ScrimWatch key={revision} lessonId={lessonId} title={title} part={loadedPart} steps={loadedSteps} media={loadedMedia} resumeAt={resumeAt} onGateDone={loadMore} onLab={() => setPhase("lab")} />
    </>
  );
}
