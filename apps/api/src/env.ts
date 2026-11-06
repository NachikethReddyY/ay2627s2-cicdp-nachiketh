import { z } from "zod";

// A blank value (e.g. `IMAGE_ESTIMATE_USD=` in .env) means unset, not 0 (which would reserve nothing).
const blankIsUnset = (v: unknown) => (v === "" ? undefined : v);

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
    IMAGE_ESTIMATE_USD: z.preprocess(blankIsUnset, z.coerce.number().nonnegative().default(0.04)),
    TIERS_JSON: z.string().optional(),
    AI_DAILY_BUDGET_USD: z.preprocess(blankIsUnset, z.coerce.number().nonnegative().default(0)),
    AI_MONTHLY_BUDGET_USD: z.preprocess(blankIsUnset, z.coerce.number().nonnegative().default(0)),
    // Estimated cost of one paid text call (outline, part, lesson), reserved before the call. A budget of 0 means unlimited.
    AI_CALL_ESTIMATE_USD: z.preprocess(blankIsUnset, z.coerce.number().nonnegative().default(0.01)),
    // Production refuses to start with both budgets at 0 unless this says the spend is meant to be uncapped.
    AI_BUDGET_UNLIMITED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
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
    // A lesson's visual pass can make up to three model calls, so the default covers the worst case.
    ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().default(400_000),
    // Per-learner Docker shell (docs/plans/sandbox-editor-plan.md). Off: /sandbox/shell answers 503 and Docker is never touched.
    SANDBOX_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    SANDBOX_IMAGE: z.string().min(1).default("lq-sandbox:dev"),
    // Where shells and practice runs execute. "daytona" uses Daytona's hosted sandboxes and never loads Docker or node-pty (docs/configuration.md).
    SANDBOX_BACKEND: z.enum(["docker", "daytona"]).default("docker"),
    DAYTONA_API_KEY: z.preprocess(blankIsUnset, z.string().min(1).optional()),
    DAYTONA_API_URL: z.preprocess(blankIsUnset, z.url().optional()),
    DAYTONA_TARGET: z.preprocess(blankIsUnset, z.string().min(1).optional()),
    // Snapshot to create learner sandboxes from. Unset: Daytona's default image.
    DAYTONA_SNAPSHOT: z.preprocess(blankIsUnset, z.string().min(1).optional()),
    // Minutes without activity before a learner's shell sandbox stops itself (Daytona enforces it, so it survives API restarts).
    DAYTONA_AUTO_STOP_MINUTES: z.coerce.number().int().positive().default(15),
    // Shell containers join this bridge (created on demand, inter-container traffic off) instead of Docker's default one.
    SANDBOX_NETWORK: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/).default("lq-sbx"),
    // Optional OCI runtime for shell containers, e.g. "runsc" (gVisor). Unset: Docker's default runtime.
    SANDBOX_RUNTIME: z.preprocess(blankIsUnset, z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional()),
    // Caps that keep one learner, or a crowd, from exhausting the host.
    SANDBOX_MAX_TABS: z.coerce.number().int().positive().default(4), // terminal tabs per learner
    SANDBOX_MAX_SHELLS: z.coerce.number().int().positive().default(50), // live shell sessions in all
    SANDBOX_MAX_RUNS: z.coerce.number().int().positive().default(20), // live code runs in all
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
  .refine(
    (e) => {
      // AI is on when either text path is configured (ai/service.ts) or image generation is (media/imagegen.ts).
      const ai = !!(e.ANTHROPIC_API_KEY || e.ENGINE_TOKEN || (e.IMAGE_BASE_URL && e.IMAGE_API_KEY && e.IMAGE_MODEL));
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

/** Exported so tests can check the rules without exiting the process. */
export const parseEnv = (source: Record<string, string | undefined>) => schema.safeParse(source);

/** Settings that are allowed but risky in production, logged loudly at startup. */
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
