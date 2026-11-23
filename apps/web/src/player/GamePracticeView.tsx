import { useState, type ReactNode } from "react";
import VisualView from "../blocks/VisualView";
import { Markdown } from "./LearnView";
import { useLessonAnalytics } from "./live/lessonAnalytics";

export function GamePracticeView({ lessonId, versionId, title, intro, doc, next, onComplete }: { lessonId: string; versionId: string; title: string; intro: string; doc: unknown; next: ReactNode; onComplete?: () => void }) {
  const analytics = useLessonAnalytics();
  const [staleVersion, setStaleVersion] = useState<string | null>(null);
  const gameWon = (lessonJustCompleted: boolean) => {
    onComplete?.();
    if (lessonJustCompleted) analytics.completed("game-practice");
  };
  return (
    <main className="lq player-content mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 pt-6 pb-4 sm:px-6" style={{ minHeight: 0 }}>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        <div className="my-auto">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <Markdown body={intro} />
        {staleVersion === versionId ? (
          <div role="alert" className="mt-6">
            <p>This lesson has changed. Reload it to continue with the latest version.</p>
            <button type="button" className="btn mt-3" onClick={() => window.location.reload()}>Reload lesson</button>
          </div>
        ) : (
          <div className="mt-6"><VisualView key={versionId} doc={doc} gameCompletion={{ lessonId, versionId, partIdx: 0, onComplete: gameWon, onStale: () => setStaleVersion(versionId) }} /></div>
        )}
      </div>
      <div className="mt-auto flex justify-center pt-8 pb-[5px]">{next}</div>
          </div>
    </main>
  );
}
