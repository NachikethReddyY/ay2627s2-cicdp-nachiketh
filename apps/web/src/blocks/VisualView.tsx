import { BLOCKS, type Spec } from "@learnquest/ui-catalog";
import BlockFrame from "./BlockFrame.tsx";
import { plan } from "./model.ts";
import { RENDERERS } from "./registry.ts";

const card = "rounded-2xl border-2 border-ink bg-white p-3 text-sm break-words";

function Rejected({ alt }: { alt: string }) {
  return <div className={card} role="img" aria-label={alt || "Visual unavailable"}>{alt || "This visual can't be shown."}</div>;
}

/** Renders a visual doc. Always re-parses first, so nothing unvalidated reaches a block. */
export default function VisualView({ doc }: { doc: unknown | Spec }) {
  const p = plan(doc);
  if (p.fatal) return <Rejected alt="" />;
  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-4 overflow-x-hidden">
      {p.items.map((it, i) => {
        if (it.kind === "rejected") return <Rejected key={i} alt={it.alt} />;
        const { block } = it;
        const View = RENDERERS[block.type];
        if (!View) return <Rejected key={block.id} alt={(block.props as { alt?: string }).alt ?? ""} />;
        const mod = BLOCKS.find((m) => m.type === block.type);
        return (
          <BlockFrame key={block.id} describe={mod?.describe(block) ?? block.type} raw={block}>
            <View block={block} />
          </BlockFrame>
        );
      })}
    </div>
  );
}
