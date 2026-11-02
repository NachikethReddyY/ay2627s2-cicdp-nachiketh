import type { BlockViewProps } from "../registry.ts";

// shortcut: placeholder URL from the asset id, no signed-URL flow; replace when the asset store lands (LQ-17)
const src = (assetId: string) => `/media/assets/${encodeURIComponent(assetId)}`;

export default function ImageView({ block }: BlockViewProps<{ assetId: string; alt: string; caption?: string }>) {
  const { assetId, alt, caption } = block.props;
  return (
    <figure className="m-0 min-w-0 max-w-full">
      <img src={src(assetId)} alt={alt} width={640} height={400} loading="lazy"
        className="block h-auto max-w-full rounded-2xl border-2 border-ink bg-white" style={{ aspectRatio: "16 / 10" }} />
      {caption && <figcaption className="mt-1 break-words text-sm">{caption}</figcaption>}
    </figure>
  );
}
