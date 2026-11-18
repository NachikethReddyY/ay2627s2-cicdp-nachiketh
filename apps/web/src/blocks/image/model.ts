const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type ImageSource = { kind: "load"; src: string } | { kind: "fallback" };

export function resolveImage(assetId: string, failedId: string | null): ImageSource {
  if (!VALID_ID.test(assetId) || assetId === failedId) return { kind: "fallback" };
  return { kind: "load", src: `/media/assets/${encodeURIComponent(assetId)}` };
}
