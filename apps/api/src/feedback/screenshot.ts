import { feedbackLimits } from "@learnquest/product-limits";
import sharp from "sharp";

export const screenshotType = "image/webp";

export async function normalizeScreenshot(encoded: string) {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > feedbackLimits.screenshotBytes || bytes.toString("base64") !== encoded) return undefined;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const isJpeg = bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
  const isWebP = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!isPng && !isJpeg && !isWebP) return undefined;

  try {
    const image = sharp(bytes, { limitInputPixels: 12_000_000, failOn: "warning" }).timeout({ seconds: 5 });
    const { pages = 1 } = await image.metadata();
    if (pages !== 1) return undefined;
    const result = await image.autoOrient()
      .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    return result.length <= feedbackLimits.screenshotBytes ? result : undefined;
  } catch {
    return undefined;
  }
}
