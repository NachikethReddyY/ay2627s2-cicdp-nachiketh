import type { ReactNode } from "react";
import VisualView from "../blocks/VisualView";
import { Markdown } from "./LearnView";

export function GamePracticeView({ lessonId, versionId, title, intro, doc, next, onComplete }: { lessonId: string; versionId: string; title: string; intro: string; doc: unknown; next: ReactNode; onComplete?: () => void }) {
  return (
    <main className="lq player-content mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 pt-6 pb-4 sm:px-6" style={{ minHeight: 0 }}>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        <div className="my-auto">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <Markdown body={intro} />
        <div className="mt-6"><VisualView doc={doc} gameCompletion={{ lessonId, versionId, partIdx: 0, onComplete }} /></div>
      </div>
      <div className="mt-auto flex justify-center pt-8 pb-[5px]">{next}</div>
          </div>
    </main>
  );
}
