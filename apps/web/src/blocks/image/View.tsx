import { useState } from "react";
import type { BlockViewProps } from "../registry.ts";
import { resolveImage } from "./model.ts";

// shortcut: /media/assets/<id> does not exist yet, so images usually show the described card; real signed-URL flow is not built (LQ-36 / image pipeline)
export default function ImageView({ block }: BlockViewProps<{ assetId: string; alt: string; caption?: string }>) {
  const { assetId, alt, caption } = block.props;
  const [failedId, setFailedId] = useState<string | null>(null);
  const img = resolveImage(assetId, failedId);
  return (
    <figure className="m-0 min-w-0 max-w-full">
      {img.kind === "load" ? (
        <img src={img.src} alt={alt} width={640} height={400} loading="lazy" onError={() => setFailedId(assetId)}
          className="block h-auto max-w-full rounded-2xl border-2 border-ink bg-white" style={{ aspectRatio: "16 / 10" }} />
      ) : (
        <div className="flex w-full max-w-full flex-col justify-center gap-1 break-words rounded-2xl border-2 border-ink bg-white p-4"
          style={{ aspectRatio: "16 / 10" }}>
          <p className="m-0 text-base">{alt}</p>
          {caption && <p className="m-0 text-sm">{caption}</p>}
        </div>
      )}
      {img.kind === "load" && caption && <figcaption className="mt-1 break-words text-sm">{caption}</figcaption>}
    </figure>
  );
}
