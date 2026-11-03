import type { ReactNode } from "react";
import VisualView from "../blocks/VisualView";
import { Markdown } from "./LearnView";

export function GamePracticeView({ title, intro, doc, next }: { title: string; intro: string; doc: unknown; next: ReactNode }) {
  return (
    <main className="lq player-content mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 pt-6 pb-4 sm:px-6" style={{ minHeight: 0 }}>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        <div className="my-auto">
        <h1 className="font-display text-3xl font-black">{title}</h1>
        <Markdown body={intro} />
        <div className="mt-6"><VisualView doc={doc} /></div>
      </div>
      <div className="mt-auto flex justify-center pt-8 pb-[5px]">{next}</div>
          </div>
    </main>
  );
}
