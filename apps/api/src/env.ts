import { z } from "zod";

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    // Neon's pooled URL (-pooler host) is set as DATABASE_URL; the direct one is required (docs/api-plan.md §1).
    DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    PUBLIC_ORIGIN: z.url().default("http://localhost:5173"),
    BETTER_AUTH_URL: z.url().optional(),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // IP or comma-separated IPs/CIDRs of the reverse proxy in front of the API. Unset: trust no forwarded address.
    TRUSTED_PROXY: z.string().optional(),
    // Optional: without a key, paths.generate answers PRECONDITION_FAILED.
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  })
  .transform((e) => ({
    ...e,
    DATABASE_URL: e.DATABASE_URL_UNPOOLED ?? e.DATABASE_URL,
    BETTER_AUTH_URL: e.BETTER_AUTH_URL ?? e.PUBLIC_ORIGIN,
  }));

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    console.error(`env ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
