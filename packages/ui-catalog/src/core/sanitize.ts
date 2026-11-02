import { z } from "zod";

// Controls (except \n), format chars (bidi overrides, zero-width, BOM, soft hyphen) and line/paragraph separators.
const UNSAFE = /(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export const sanitize = (s: string): string => s.replace(UNSAFE, "").normalize("NFKC").replace(UNSAFE, "");

// Sanitised, trimmed, non-empty text capped at `max` chars (checked after sanitising).
// `.overwrite` keeps the schema a plain string for JSON Schema generation.
export const text = (max: number) => z.string().overwrite(sanitize).trim().min(1).max(max);
