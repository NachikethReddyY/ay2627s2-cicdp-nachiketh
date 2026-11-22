import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db, type Db } from "../db/client.ts";
import { withTx } from "../db/tx.ts";
import { env } from "../env.ts";
import { aiGenerations, enrollments, generationCache, learners, lessons, lessonVersions, pathCourses, paths, steps, worlds, type GeneratedPart } from "../db/schema.ts";
import { generator, type LessonContext } from "./generator.ts";
import { checkStep, Step, text, type GeneratedStep } from "./step-schema.ts";
import { EngineError } from "../engine-client/client.ts";
import { engineParts, type PartContext } from "../engine-client/parts.ts";
import { validatePart } from "../visuals/gate.ts";
import { prewarmDocImages } from "../media/imagegen.ts";
import { mvpLimits } from "../config/limits.ts";
import { ENGINE_CALLS_PER_PART, ENGINE_CALLS_PER_REPLY, reserveAiSpend } from "../config/budget.ts";
import { isSafe, isSafeText } from "../safety/moderation.ts";
import { REFUSAL_COPY } from "../safety/copy.ts";
import { measureGeneration } from "./telemetry.ts";

const Outline = z.union([
  z.object({ refused: z.literal(true) }),
  z.object({
    title: text(80),
    tagline: text(160),
    courses: z
      .array(
        z.object({
          title: text(80),
          description: text(300),
          lessons: z
            .array(z.object({ title: text(80), level: z.number().int().min(1).max(5), concepts: z.array(text(60)).min(1).max(6), kind: z.enum(["predict", "learn", "watch", "practice", "game-practice", "scrim"]) }))
            .min(3)
            .max(6),
        }),
      )
      .min(2)
      .max(4),
  }),
]);

const Lesson = z.object({ steps: z.array(Step).min(3).max(5) });

const slugify = (s: string, max: number) =>
  `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max) || "x"}-${randomBytes(6).toString("hex")}`;

function assertAiEnabled() {
  if (env.AI_KILL_SWITCH) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI is temporarily unavailable" });
}

export async function generatePath(learnerId: string, topic: string) {
  assertAiEnabled();
  if (!(await isSafeText(topic))) throw new TRPCError({ code: "PRECONDITION_FAILED", message: REFUSAL_COPY });
  if (!env.ENGINE_TOKEN) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI is not configured" });
  const [me] = await db.select({ userId: learners.userId }).from(learners).where(eq(learners.id, learnerId));
  const slot = await withTx(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${me.userId}))`);
    const {
      rows: [{ n }],
    } = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ai_generations WHERE user_id = ${me.userId} AND created_at > now() - interval '24 hours'`);
    if (n >= mvpLimits.aiPathsPerDay) return null;
    const [row] = await tx.insert(aiGenerations).values({ userId: me.userId }).returning({ id: aiGenerations.id });
    return row.id;
  });
  if (!slot) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `You've reached your ${mvpLimits.aiPathsPerDay} AI paths for today` });
  try {
    await reserveAiSpend(env.AI_CALL_ESTIMATE_USD * ENGINE_CALLS_PER_REPLY);
  } catch (e) {
    await db.delete(aiGenerations).where(eq(aiGenerations.id, slot));
    throw e;
  }

  let outline;
  try {
    outline = Outline.parse(await measureGeneration("outline", () => generator.outline(topic)));
    if (!(await isSafeText(JSON.stringify(outline)))) throw new Error("Generated content refused by safety filter");
  } catch (e) {
    console.error("outline generation failed");
    if (e instanceof EngineError) {
      if (e.status >= 500) await db.delete(aiGenerations).where(eq(aiGenerations.id, slot)).catch(() => undefined);
      if (e.status === 504) throw new TRPCError({ code: "TIMEOUT", message: "That path took too long to generate. Try again." });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't build that path. Try again." });
  }
  if ("refused" in outline) throw new TRPCError({ code: "BAD_REQUEST", message: REFUSAL_COPY });

  let path;
  try {
    path = await persistPath(me.userId, learnerId, outline);
  } catch (e) {
    await db.delete(aiGenerations).where(eq(aiGenerations.id, slot)).catch(() => undefined);
    throw e;
  }
  if (env.AI_WRITE_COURSE_ON_GENERATE) writeLessons(path.lessonIds, learnerId);
  return { slug: path.slug, firstCourseSlug: path.firstCourseSlug };
}

async function persistPath(ownerId: string, learnerId: string, outline: Exclude<z.infer<typeof Outline>, { refused: true }>) {
  return withTx(async (tx) => {
    const owned = { ownerId, visibility: "private", origin: "ai" } as const;
    const [path] = await tx
      .insert(paths)
      .values({ slug: slugify(outline.title, 40), title: outline.title, tagline: outline.tagline, ...owned })
      .returning();
    const courseSlugs: string[] = [];
    const lessonIds: string[] = [];
    for (const [position, c] of outline.courses.entries()) {
      const [world] = await tx
        .insert(worlds)
        .values({ slug: slugify(c.title, 40), title: c.title, description: c.description, ...owned })
        .returning();
      courseSlugs.push(world.slug);
      await tx.insert(pathCourses).values({ pathId: path.id, worldId: world.id, position });
      const rows = await tx
        .insert(lessons)
        .values(
          c.lessons.map((l, i) => ({
            slug: slugify(l.title, 40),
            worldId: world.id,
            title: l.title,
            level: 1,
            position: i,
            concepts: l.concepts,
            kind: l.kind,
            sourceKind: "ai" as const,
            status: "draft" as const,
          })),
        )
        .returning({ id: lessons.id });
      lessonIds.push(...rows.map((r) => r.id));
    }
    await tx.insert(enrollments).values({ learnerId, pathId: path.id });
    return { slug: path.slug, firstCourseSlug: courseSlugs[0], lessonIds };
  });
}

function validate(raw: unknown): GeneratedStep[] {
  const { steps } = Lesson.parse(raw);
  for (const s of steps) checkStep(s);
  return steps;
}

async function moderated<T>(v: T, isPublic: boolean): Promise<T> {
  const text = JSON.stringify(v);
  if (!(await (isPublic ? isSafe(text) : isSafeText(text)))) throw new Error("Generated content refused by safety filter");
  return v;
}

const PART_CACHE_VERSION = 1;

type LessonRow = typeof lessons.$inferSelect;

function partCacheKey(ctx: LessonContext) {
  return createHash("sha256").update(`v${PART_CACHE_VERSION}:${JSON.stringify({ ...ctx, missedConcepts: [] })}`).digest("hex");
}

async function cachedPart(key: string): Promise<GeneratedPart | null> {
  const [hit] = await db.select({ content: generationCache.content }).from(generationCache).where(eq(generationCache.key, key)).limit(1);
  if (!hit) return null;
  try {
    return validatePart(hit.content);
  } catch {
    return null;
  }
}

async function lessonContext(l: LessonRow): Promise<LessonContext> {
  const [world] = await db.select().from(worlds).where(eq(worlds.id, l.worldId));
  const [path] = await db
    .select({ title: paths.title, tagline: paths.tagline })
    .from(pathCourses)
    .innerJoin(paths, eq(paths.id, pathCourses.pathId))
    .where(eq(pathCourses.worldId, l.worldId))
    .limit(1);
  return {
    path: path ?? { title: world.title, tagline: "" },
    course: { title: world.title, description: world.description },
    lesson: { title: l.title, level: l.level, concepts: l.concepts, kind: l.kind },
    missedConcepts: [],
    ...((l.kind === "practice" || l.kind === "scrim") && { stretchTests: env.PRACTICE_STRETCH_TESTS }),
  };
}

type Generated = { part: GeneratedPart | null; generated: GeneratedStep[] };

async function generate(ctx: LessonContext, key: string | null, cached: GeneratedPart | null, isPublic: boolean): Promise<Generated> {
  let part = cached && isPublic ? await moderated(cached, true) : cached;
  if (key && !part) {
    const partCtx: PartContext = { ...ctx, missedConcepts: [] };
    part = await moderated(validatePart(await measureGeneration("part", () => engineParts.lesson(partCtx))), isPublic);
    await db.insert(generationCache).values({ key, kind: part.kind, content: part }).onConflictDoNothing();
  }
  const generated = key ? [] : await moderated(validate(await measureGeneration("lesson", () => generator.lesson(ctx))), isPublic);
  return { part, generated };
}

function splitPart(part: GeneratedPart | null) {
  if (part && "steps" in part) {
    const { steps: gateSteps, ...content } = part;
    return { content, gateSteps };
  }
  return { content: part, gateSteps: null };
}

function stepRows(lessonVersionId: string, list: readonly GeneratedStep[]) {
  return list.map((s, idx) => ({
    lessonVersionId,
    idx,
    public: { title: s.title, prompt: s.prompt, kind: s.kind, ...(s.kind === "mcq" && { options: s.options }) },
    secret: {
      beforeFiles: s.beforeFiles,
      hunks: s.hunks,
      answer: s.answer,
      ...(s.kind === "cloze" && { accepted: [...new Set([s.answer, ...s.accepted])] }),
      hints: s.hints,
      explanations: s.explanations,
      concepts: s.concepts,
    },
  }));
}

async function writeOnce(tx: Db, lessonId: string, usedPublicModeration: boolean, { part, generated }: Generated) {
  const [l] = await tx.select().from(lessons).where(eq(lessons.id, lessonId)).for("update");
  if (!l || l.currentVersionId || l.sourceKind !== "ai") return null;

  const [world] = await tx.select({ visibility: worlds.visibility }).from(worlds).where(eq(worlds.id, l.worldId));
  if (world.visibility === "public" && !usedPublicModeration) {
    throw new Error("Lesson must pass public moderation before it can be saved");
  }

  const { content, gateSteps } = splitPart(part);
  const [version] = await tx
    .insert(lessonVersions)
    .values({ lessonId: l.id, version: 1, publishedAt: l.status === "published" ? new Date() : null, content })
    .returning();
  const prewarm = part && (part.kind === "learn" || part.kind === "game-practice") && part.doc ? part.doc : null;
  const stepList = part ? (gateSteps ?? []) : generated;
  if (stepList.length) await tx.insert(steps).values(stepRows(version.id, stepList));
  await tx.update(lessons).set({ currentVersionId: version.id }).where(eq(lessons.id, l.id));
  return { lessonVersionId: version.id, prewarm };
}

const inflight = new Map<string, Promise<boolean>>();
const queued = new Set<string>();
const failed = new Set<string>();

export type WriteState = "ready" | "writing" | "failed" | "pending";

export function lessonWriteState(lessonId: string, written: boolean): WriteState {
  if (written) return "ready";
  if (queued.has(lessonId) || inflight.has(lessonId)) return "writing";
  return failed.has(lessonId) ? "failed" : "pending";
}

export function ensureLesson(lessonId: string, learnerId: string): Promise<boolean> {
  const running = inflight.get(lessonId);
  if (running) return running;
  const p = writeLesson(lessonId, learnerId)
    .then(
      (ok) => {
        failed.delete(lessonId);
        return ok;
      },
      (e: unknown) => {
        failed.add(lessonId);
        throw e;
      },
    )
    .finally(() => inflight.delete(lessonId));
  inflight.set(lessonId, p);
  return p;
}

export const LESSON_WRITE_CONCURRENCY = 3;

export function writeLessons(lessonIds: readonly string[], learnerId: string): void {
  for (const id of lessonIds) queued.add(id);
  let next = 0;
  const worker = async () => {
    while (next < lessonIds.length) {
      const id = lessonIds[next++]!;
      await ensureLesson(id, learnerId)
        .catch((e) => console.error("background lesson write failed", e))
        .finally(() => queued.delete(id));
    }
  };
  const workers = Math.min(LESSON_WRITE_CONCURRENCY, lessonIds.length);
  const p: Promise<unknown> = Promise.all(Array.from({ length: workers }, worker)).finally(() => background.delete(p));
  background.add(p);
}

async function writeLesson(lessonId: string, learnerId: string): Promise<boolean> {
  const [pre] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!pre || pre.currentVersionId || pre.sourceKind !== "ai") return false;
  assertAiEnabled();
  const ctx = await lessonContext(pre);
  const key = pre.kind === "predict" ? null : partCacheKey(ctx);
  const cached = key ? await cachedPart(key) : null;

  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const [world] = await db.select({ visibility: worlds.visibility }).from(worlds).where(eq(worlds.id, pre.worldId));
    const isPublic = world?.visibility === "public";
    if (!cached) await reserveAiSpend(env.AI_CALL_ESTIMATE_USD * (key ? ENGINE_CALLS_PER_PART : ENGINE_CALLS_PER_REPLY));
    try {
      const result = await generate(ctx, key, cached, isPublic);
      const written = await withTx((tx) => writeOnce(tx, lessonId, isPublic, result));
      if (!written) return false;
      if (written.prewarm) {
        const p: Promise<unknown> = prewarmDocImages(written.prewarm, { lessonVersionId: written.lessonVersionId, learnerId })
          .catch((e) => console.error("prewarm of lesson images failed", e))
          .finally(() => background.delete(p));
        background.add(p);
      }
      return true;
    } catch (e) {
      if (e instanceof TRPCError) throw e;
      last = e;
      console.error(`lesson generation attempt ${attempt + 1} failed`, e);
    }
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't write this lesson. Try again.", cause: last });
}

const background = new Set<Promise<unknown>>();
export const idle = () => Promise.allSettled([...background]);

const PREFETCH_THROTTLE_MS = 60_000;
const prefetchedAt = new Map<string, number>();

export function prefetchNext(lesson: typeof lessons.$inferSelect, learnerId: string) {
  const now = Date.now();
  const tag = `${learnerId}:${lesson.id}`;
  if (now - (prefetchedAt.get(tag) ?? 0) < PREFETCH_THROTTLE_MS) return;
  if (prefetchedAt.size > 5000) for (const [k, t] of prefetchedAt) if (now - t >= PREFETCH_THROTTLE_MS) prefetchedAt.delete(k);
  prefetchedAt.set(tag, now);
  const p = (async () => {
    const [next] = await db
      .select({ id: lessons.id, v: lessons.currentVersionId, kind: lessons.kind })
      .from(lessons)
      .where(
        and(
          eq(lessons.worldId, lesson.worldId),
          sql`(${lessons.level}, ${lessons.position}, ${lessons.id}) > (${lesson.level}, ${lesson.position}, ${lesson.id})`,
        ),
      )
      .orderBy(asc(lessons.level), asc(lessons.position), asc(lessons.id))
      .limit(1);
    if (next && !next.v && next.kind === "predict") await ensureLesson(next.id, learnerId);
  })()
    .catch((e) => console.error("prefetch of next lesson failed", e))
    .finally(() => background.delete(p));
  background.add(p);
}
