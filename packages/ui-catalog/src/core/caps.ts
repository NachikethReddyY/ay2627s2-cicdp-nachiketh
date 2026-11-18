import { z } from "zod";
import { text } from "./sanitize.ts";

export const MAX_SPEC_BYTES = 64 * 1024;
export const MIN_BLOCKS = 1;
export const MAX_BLOCKS = 12;
export const MAX_ALT = 200;

export const ID_RE = /^[a-z0-9_]{1,24}$/;
export const id = () => z.string().regex(ID_RE);

export const THEME_COLORS = ["ink", "paper", "green", "green-deep", "blue", "sun", "pink", "lilac", "mint"] as const;
export const color = () => z.enum(THEME_COLORS);

export const alt = () => text(MAX_ALT);
