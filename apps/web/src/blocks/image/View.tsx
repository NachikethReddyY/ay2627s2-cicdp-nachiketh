import { useState } from "react";
import type { BlockViewProps } from "../registry.ts";
import { resolveImage } from "./model.ts";

type Props = { source?: string; assetId?: string; url?: string; alt: string; caption?: string };

export default function ImageView({ block }: BlockViewProps<Props>) {
  const { source, alt, caption } = block.props;
  const assetId = source === "generated" ? (block.props.url ?? "") : (block.props.assetId ?? "");
  const [failedId, setFailedId] = useState<string | null>(null);
  const img = source === "generated"
    ? (assetId && assetId !== failedId ? { kind: "load" as const, src: assetId } : { kind: "fallback" as const })
    : source === "asset" ? resolveImage(assetId, failedId) : { kind: "fallback" as const };
  return (
    <figure className="m-0 min-w-0 max-w-full">
      {img.kind === "load" ? (
        <img src={img.src} alt={alt} width={640} height={400} loading="lazy" onError={() => setFailedId(assetId)}
          className="block h-auto max-w-full rounded-2xl border border-[var(--line)] bg-[var(--code)]" style={{ aspectRatio: "16 / 10" }} />
      ) : (
        <div className="flex w-full max-w-full flex-col justify-center gap-1 break-words rounded-2xl border border-[var(--line)] bg-[var(--code)] p-4"
          style={{ aspectRatio: "16 / 10" }}>
          <p className="m-0 text-base">{alt}</p>
          {caption && <p className="m-0 text-sm">{caption}</p>}
        </div>
      )}
      {img.kind === "load" && caption && <figcaption className="mt-1 break-words text-sm">{caption}</figcaption>}
    </figure>
  );
}
