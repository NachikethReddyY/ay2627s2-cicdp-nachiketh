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
    MODERATION_API_KEY: z.string().min(1).optional(),
    IMAGE_BASE_URL: z.url().optional(),
    IMAGE_API_KEY: z.string().min(1).optional(),
    IMAGE_MODEL: z.string().min(1).optional(),
    IMAGE_API_STYLE: z.enum(["images", "chat"]).default("images"),
    TIERS_JSON: z.string().optional(),
    AI_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(0),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(0),
    AI_KILL_SWITCH: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    // Lesson media bucket (docs/media-storage-plan.md §2). Unset: media calls answer PRECONDITION_FAILED.
    S3_ENDPOINT: z.url().optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_REGION: z.string().default("auto"),
    // Dev-only visual playground (/api/dev/visual): the Python engine and the token it shares with services/engine/.env.
    ENGINE_URL: z.url().default("http://localhost:8000"),
    ENGINE_TOKEN: z.string().min(32).optional(),
    // Per-learner Docker shell (docs/plans/sandbox-editor-plan.md). Off: /sandbox/shell answers 503 and Docker is never touched.
    SANDBOX_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    SANDBOX_IMAGE: z.string().min(1).default("lq-sandbox:dev"),
  })
  .refine(
    (e) => {
      const s3 = [e.S3_ENDPOINT, e.S3_BUCKET, e.S3_ACCESS_KEY_ID, e.S3_SECRET_ACCESS_KEY];
      return s3.every(Boolean) || !s3.some(Boolean);
    },
    { message: "set all of S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, or none", path: ["S3_BUCKET"] },
  )
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
