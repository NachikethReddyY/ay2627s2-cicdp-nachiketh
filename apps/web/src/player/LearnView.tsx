import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { FOCUS } from "./ui";
import VisualView from "../blocks/VisualView";
import { keepLineBreaks } from "./markdownText.ts";

// Markdown for learn and game-practice parts: same plugins and code-block focus styling.
export function Markdown({ body }: { body: string }) {
  // Lessons written before the prompt fix hold HTML line breaks.
  const markdown = keepLineBreaks(body.replace(/<br\s*\/?>/gi, "\n"));
  return (
    <div className="learn-md mt-4 font-semibold">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ node, ...props }) => <pre tabIndex={0} className={`chunk overflow-x-auto bg-white p-4 text-sm ${FOCUS}`} {...props} />,
          // Model-written image links could point at any host, so show the description instead of loading them.
          img: ({ alt }) => <span className="italic">{alt}</span>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export function LearnView({ title, body, doc, next }: { title: string; body: string; doc?: unknown; next: ReactNode }) {
  return (
    <main className="lq player-content mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 pt-6 pb-4 sm:px-6" style={{ minHeight: 0 }}>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        <div className="pt-2">
        <h1 className="font-display text-3xl font-black">{title}</h1>
        <Markdown body={body} />
        {doc != null && <div className="mt-6"><VisualView doc={doc} /></div>}
      </div>
      <div className="mt-auto flex justify-center pt-8 pb-[5px]">{next}</div>
          </div>
    </main>
  );
}
