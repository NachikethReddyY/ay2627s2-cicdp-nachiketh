import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());
const createdAt = () => timestamp("created_at").notNull().defaultNow();

// Better Auth tables (shape per its Drizzle adapter docs).
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// App tables.
export const learners = pgTable("learners", {
  id: id(),
  kind: text("kind", { enum: ["user"] })
    .notNull()
    .default("user"),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  // Plan tier selects the configured daily AI path limit.
  tier: text("tier", { enum: ["free", "pro", "max"] })
    .notNull()
    .default("free"),
  // IANA name; streak days are counted in this zone.
  timezone: text("timezone").notNull().default("UTC"),
  dailyGoalXp: integer("daily_goal_xp").notNull().default(50),
});

const visibility = () =>
  text("visibility", { enum: ["private", "public"] })
    .notNull()
    .default("public");
const origin = () =>
  text("origin", { enum: ["official", "community", "ai"] })
    .notNull()
    .default("official");
const ownerId = () => text("owner_id").references(() => user.id, { onDelete: "cascade" });

// A world is a course in the UI.
export const worlds = pgTable("worlds", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  ownerId: ownerId(),
  visibility: visibility(),
  origin: origin(),
  config: jsonb("config").notNull().default({}),
});

// One row per paths.generate call that reached the AI, rejected topics included; the daily limit counts these.
export const aiGenerations = pgTable(
  "ai_generations",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [index("ai_generations_user_time").on(t.userId, t.createdAt)],
);

export const spendLedger = pgTable("spend_ledger", {
  id: id(),
  amountUsd: integer("amount_usd").notNull(),
  createdAt: createdAt(),
});

export const paths = pgTable("paths", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  tagline: text("tagline").notNull().default(""),
  ownerId: ownerId(),
  visibility: visibility(),
  origin: origin(),
  createdAt: createdAt(),
});

export const pathCourses = pgTable(
  "path_courses",
  {
    pathId: text("path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    worldId: text("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.pathId, t.worldId] })],
);

export const enrollments = pgTable(
  "enrollments",
  {
    learnerId: text("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    pathId: text("path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.pathId] })],
);

export const concepts = pgTable(
  "concepts",
  {
    id: id(),
    worldId: text("world_id")
      .notNull()
      .references(() => worlds.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("concepts_world_slug").on(t.worldId, t.slug)],
);

export type LessonSource = { repo: string; sha: string; path: string };

export type Hunk = { id: string; file: string; oldStart: number; lines: string[] };
export type PartSecret =
  | { kind: "learn"; body: string }
  | { kind: "watch"; beforeFiles: Record<string, string>; hunks: Hunk[] }
  | { kind: "practice"; instructions: string; language?: "python" | "javascript"; starterCode: string; expectedOutput: string };

export const lessons = pgTable("lessons", {
  id: id(),
  slug: text("slug").notNull().unique(),
  worldId: text("world_id")
    .notNull()
    .references(() => worlds.id),
  title: text("title").notNull(),
  level: integer("level").notNull().default(1),
  position: integer("position").notNull().default(0),
  sourceKind: text("source_kind", { enum: ["repo", "authored", "ai"] }).notNull(),
  // predict = mcq/cloze steps; learn/watch/practice = one part with content in lesson_versions.content.
  kind: text("kind", { enum: ["predict", "learn", "watch", "practice"] })
    .notNull()
    .default("predict"),
  source: jsonb("source").$type<LessonSource>(),
  // Concepts the lesson should teach; the AI outline stores them here for the lazy lesson call.
  concepts: text("concepts").array().notNull().default(sql`'{}'::text[]`),
  status: text("status", { enum: ["draft", "published", "archived"] })
    .notNull()
    .default("draft"),
  // No FK to lesson_versions: it would be circular; the app keeps it consistent.
  currentVersionId: text("current_version_id"),
  createdAt: createdAt(),
});

export const lessonVersions = pgTable(
  "lesson_versions",
  {
    id: id(),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lessons.id),
    version: integer("version").notNull(),
    createdAt: createdAt(),
    publishedAt: timestamp("published_at"),
    // Content of a learn/watch/practice part; null for predict lessons, whose content is in steps.
    content: jsonb("content").$type<PartSecret>(),
  },
  (t) => [uniqueIndex("lesson_versions_lesson_version").on(t.lessonId, t.version)],
);

export type StepPublic = { title: string; prompt: string; kind: "mcq" | "cloze"; options?: string[] };
export type StepSecret = {
  beforeFiles: Record<string, string>;
  hunks: unknown[];
  answer: number | string;
  accepted?: string[];
  hints: { text: string; eliminate?: number }[];
  explanations: { workedExample: string; practice: string };
  // Recorded as attempts.missed_concepts on a wrong answer (AI lessons only).
  concepts?: string[];
};

export const steps = pgTable(
  "steps",
  {
    id: id(),
    lessonVersionId: text("lesson_version_id")
      .notNull()
      .references(() => lessonVersions.id),
    idx: integer("idx").notNull(),
    public: jsonb("public").$type<StepPublic>().notNull(),
    secret: jsonb("secret").$type<StepSecret>().notNull(),
  },
  (t) => [uniqueIndex("steps_version_idx").on(t.lessonVersionId, t.idx)],
);

export const stepProgress = pgTable(
  "step_progress",
  {
    learnerId: text("learner_id")
      .notNull()
      .references(() => learners.id),
    stepId: text("step_id")
      .notNull()
      .references(() => steps.id),
    state: text("state", { enum: ["predicting", "hinting", "revealed", "skipped"] })
      .notNull()
      .default("predicting"),
    rungsTaken: integer("rungs_taken").notNull().default(0),
    attemptAllowed: boolean("attempt_allowed").notNull().default(true),
    retryAllowed: boolean("retry_allowed").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.stepId] })],
);

export const attempts = pgTable(
  "attempts",
  {
    id: id(),
    learnerId: text("learner_id")
      .notNull()
      .references(() => learners.id),
    stepId: text("step_id")
      .notNull()
      .references(() => steps.id),
    kind: text("kind", { enum: ["mcq", "cloze", "skip"] }).notNull(),
    response: jsonb("response"),
    observed: boolean("observed").notNull(),
    correct: boolean("correct"),
    hintsUsed: integer("hints_used").notNull().default(0),
    feedback: jsonb("feedback"),
    missedConcepts: text("missed_concepts")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("attempts_one_observed")
      .on(t.learnerId, t.stepId)
      .where(sql`${t.observed}`),
    index("attempts_step").on(t.stepId),
  ],
);

export const hintEvents = pgTable(
  "hint_events",
  {
    learnerId: text("learner_id")
      .notNull()
      .references(() => learners.id),
    stepId: text("step_id")
      .notNull()
      .references(() => steps.id),
    rung: integer("rung").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.stepId, t.rung] })],
);

// Per-version lesson media, object bytes live in the bucket under `key` (docs/media-storage-plan.md §3.3).
export const lessonMedia = pgTable(
  "lesson_media",
  {
    id: id(),
    lessonVersionId: text("lesson_version_id")
      .notNull()
      .references(() => lessonVersions.id),
    // Null = lesson-level (cover image).
    stepId: text("step_id").references(() => steps.id),
    kind: text("kind", { enum: ["narration", "image"] }).notNull(),
    key: text("key").notNull().unique(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("lesson_media_version").on(t.lessonVersionId)],
);
