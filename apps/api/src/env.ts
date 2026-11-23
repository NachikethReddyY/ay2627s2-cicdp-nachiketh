import { z } from "zod";

const blankIsUnset = (v: unknown) => (v === "" ? undefined : v);

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    PUBLIC_ORIGIN: z.url().default("http://localhost:5173"),
    BETTER_AUTH_URL: z.url().optional(),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    TRUSTED_PROXY: z.string().optional(),
    MODERATION_API_KEY: z.string().min(1).optional(),
    MODERATION_BASE_URL: z.url().default("https://api.openai.com/v1/"),
    MODERATION_ESTIMATE_USD: z.preprocess(blankIsUnset, z.coerce.number().nonnegative().default(0)),
    MODERATION_MODEL: z.string().min(1).default("omni-moderation-latest"),
    OPENROUTER_API_KEY: z.preprocess(blankIsUnset, z.string().min(1).optional()),
    STUDIO_TTS_MODEL: z.preprocess(blankIsUnset, z.string().min(1).default("hexgrad/kokoro-82m")),
    STUDIO_TTS_VOICE: z.preprocess(blankIsUnset, z.string().min(1).default("af_heart")),
    STUDIO_TTS_ESTIMATE_USD: z.preprocess(blankIsUnset, z.coerce.number().min(0.0001).max(100).default(0.01)),
    TOKENROUTER_API_KEY: z.preprocess(blankIsUnset, z.string().min(1).optional()),
    IMAGE_BASE_URL: z.url().optional(),
    IMAGE_API_KEY: z.string().min(1).optional(),
    IMAGE_MODEL: z.string().min(1).optional(),
    IMAGE_API_STYLE: z.enum(["images", "chat"]).default("images"),
    IMAGE_ESTIMATE_USD: z.preprocess(blankIsUnset, z.coerce.number().nonnegative().default(0.04)),
    AI_DAILY_BUDGET_USD: z.preprocess(blankIsUnset, z.coerce.number().nonnegative().default(0)),
    AI_MONTHLY_BUDGET_USD: z.preprocess(blankIsUnset, z.coerce.number().nonnegative().default(0)),
    AI_CALL_ESTIMATE_USD: z.preprocess(blankIsUnset, z.coerce.number().nonnegative().default(0.01)),
    AI_BUDGET_UNLIMITED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    AI_KILL_SWITCH: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    AI_WRITE_COURSE_ON_GENERATE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
    S3_ENDPOINT: z.url().optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_REGION: z.string().default("auto"),
    POSTHOG_PROJECT_TOKEN: z.preprocess(blankIsUnset, z.string().min(1).optional()),
    POSTHOG_HOST: z.preprocess(blankIsUnset, z.url({ protocol: /^https?$/ }).optional()),
    ENGINE_URL: z.url().default("http://localhost:8000"),
    ENGINE_TOKEN: z.string().min(32).optional(),
    ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().default(400_000),
    OUTLINE_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
    SANDBOX_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    SANDBOX_IMAGE: z.string().min(1).default("lq-sandbox:dev"),
    SANDBOX_BACKEND: z.enum(["docker", "daytona"]).default("docker"),
    DAYTONA_API_KEY: z.preprocess(blankIsUnset, z.string().min(1).optional()),
    DAYTONA_API_URL: z.preprocess(blankIsUnset, z.url().optional()),
    DAYTONA_TARGET: z.preprocess(blankIsUnset, z.string().min(1).optional()),
    DAYTONA_SNAPSHOT: z.preprocess(blankIsUnset, z.string().min(1).optional()),
    DAYTONA_AUTO_STOP_MINUTES: z.coerce.number().int().positive().default(3),
    SANDBOX_NETWORK: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/).default("lq-sbx"),
    SANDBOX_RUNTIME: z.preprocess(blankIsUnset, z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional()),
    IMPORT_REPO_ALLOWLIST: z
      .string()
      .default("")
      .transform((v) => v.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean)),
    SANDBOX_MAX_TABS: z.coerce.number().int().positive().default(4),
    SANDBOX_MAX_SHELLS: z.coerce.number().int().positive().default(50),
    SANDBOX_MAX_RUNS: z.coerce.number().int().positive().default(20),
    PRACTICE_STRETCH_TESTS: z.coerce.number().int().min(0).max(10).default(0),
  })
  .refine((e) => !e.SANDBOX_ENABLED || e.SANDBOX_BACKEND !== "daytona" || !!e.DAYTONA_API_KEY, {
    message: "SANDBOX_BACKEND=daytona needs DAYTONA_API_KEY",
    path: ["DAYTONA_API_KEY"],
  })
  .refine(
    (e) => {
      const s3 = [e.S3_ENDPOINT, e.S3_BUCKET, e.S3_ACCESS_KEY_ID, e.S3_SECRET_ACCESS_KEY];
      return s3.every(Boolean) || !s3.some(Boolean);
    },
    { message: "set all of S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, or none", path: ["S3_BUCKET"] },
  )
  .transform(({ TOKENROUTER_API_KEY, ...e }) => ({
    ...e,
    IMAGE_API_KEY: TOKENROUTER_API_KEY ?? e.IMAGE_API_KEY,
    IMAGE_BASE_URL: e.IMAGE_BASE_URL ?? (TOKENROUTER_API_KEY ? "https://api.tokenrouter.com/v1" : undefined),
  }))
  .refine(
    (e) => {
      const ai = !!(e.ENGINE_TOKEN || (e.IMAGE_BASE_URL && e.IMAGE_API_KEY && e.IMAGE_MODEL) || (e.OPENROUTER_API_KEY && e.S3_BUCKET));
      return e.NODE_ENV !== "production" || !ai || e.AI_BUDGET_UNLIMITED || e.AI_DAILY_BUDGET_USD > 0 || e.AI_MONTHLY_BUDGET_USD > 0;
    },
    {
      message: "AI is enabled with no spend cap: set AI_DAILY_BUDGET_USD and/or AI_MONTHLY_BUDGET_USD, or AI_BUDGET_UNLIMITED=true to run uncapped",
      path: ["AI_DAILY_BUDGET_USD"],
    },
  )
  .transform((e) => ({
    ...e,
    DATABASE_URL: e.DATABASE_URL_UNPOOLED ?? e.DATABASE_URL,
    BETTER_AUTH_URL: e.BETTER_AUTH_URL ?? e.PUBLIC_ORIGIN,
  }));

export const parseEnv = (source: Record<string, string | undefined>) => schema.safeParse(source);

export function startupWarnings(e: Pick<Env, "NODE_ENV" | "TRUSTED_PROXY">): string[] {
  if (e.NODE_ENV !== "production") return [];
  return e.TRUSTED_PROXY
    ? []
    : ["TRUSTED_PROXY is unset: behind a proxy (Vercel -> Render) every request shares the proxy's IP, so the auth rate limit is one bucket for all users. Set it to the proxy's IPs/CIDRs."];
}

const parsed = parseEnv(process.env);
if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    console.error(`env ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export type Env = z.infer<typeof schema>;
export const env = parsed.data;
