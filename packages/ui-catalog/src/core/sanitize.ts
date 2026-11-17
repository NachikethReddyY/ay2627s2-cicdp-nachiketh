import { z } from "zod";

const UNSAFE = /(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export const sanitize = (s: string): string => s.replace(UNSAFE, "").normalize("NFKC").replace(UNSAFE, "");

export const text = (max: number) => z.string().overwrite(sanitize).trim().min(1).max(max);
