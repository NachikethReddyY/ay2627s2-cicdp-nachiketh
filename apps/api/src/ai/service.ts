import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildTimeline, seek } from "@learnquest/player-core";
import { db, type Db } from "../db/client.ts";
import { withTx } from "../db/tx.ts";
import { env } from "../env.ts";
import { aiGenerations, enrollments, generationCache, learners, lessons, lessonVersions, pathCourses, paths, steps, worlds, type PartSecret } from "../db/schema.ts";
import { generator, type LessonContext } from "./generator.ts";
import { engineParts, type PartContext } from "../engine-client/parts.ts";
import { validatePart } from "../visuals/gate.ts";
import { prewarmDocImages } from "../media/imagegen.ts";
import { tiers } from "../config/tiers.ts";
import { ENGINE_CALLS_PER_PART, reserveAiSpend } from "../config/budget.ts";
import { isSafe, isSafeText } from "../safety/moderation.ts";
import { REFUSAL_COPY } from "../safety/copy.ts";
import { measureGeneration } from "./telemetry.ts";

const text = (max: number) => z.string().trim().min(1).max(max);
const Outline = z.union([
  z.object({ refused: z.literal(true) }),
  z.object({
    title: text(80),
    tagline: text(160),
    subject: z.enum(["code", "other"]),
    courses: z
      .array(
        z.object({
          title: text(80),
          description: text(300),
          lessons: z
            .array(z.object({ title: text(80), level: z.number().int().min(1).max(5), concepts: z.array(text(60)).min(1).max(6), kind: z.enum(["learn", "watch", "practice", "game-practice"]) }))
            .min(3)
            .max(6),
        }),
      )
      .min(2)
      .max(4),
  }).refine(
    (o) => o.subject === "code" || o.courses.every((c) => c.lessons.every((l) => l.kind === "learn" || l.kind === "game-practice")),
    "non-coding outline may only use learn and game-practice lessons",
  ),
]);

const Hunk = z.object({ id: text(40), file: text(200), oldStart: z.number().int().min(1), lines: z.array(z.string().max(300)).min(1).max(60) });
const Hint = z.object({ text: text(400), eliminate: z.number().int().min(0).max(3).optional() });
const Common = {
  title: text(100),
  prompt: text(500),
  beforeFiles: z.record(text(200), z.string().max(6000)).refine((f) => Object.keys(f).length >= 1 && Object.keys(f).length <= 4),
  hunks: z.array(Hunk).min(1).max(6),
  hints: z.array(Hint).min(1).max(2),
  explanations: z.object({ workedExample: text(1000), practice: text(500) }),
  concepts: z.array(text(60)).max(6).default([]),
};
const Step = z.discriminatedUnion("kind", [
  z.object({
    ...Common,
    kind: z.literal("mcq"),
    options: z.array(text(200)).length(4),
    answer: z.number().int().min(0).max(3),
  }),
  z.object({ ...Common, kind: z.literal("cloze"), answer: text(100), accepted: z.array(text(100)).max(6).default([]) }),
]);
const Lesson = z.object({ steps: z.array(Step).min(3).max(5) });
type GeneratedStep = z.infer<typeof Step>;

const slugify = (s: string, max: number) =>
  `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max) || "x"}-${randomBytes(6).toString("hex")}`;

function assertAiEnabled() {
  if (env.AI_KILL_SWITCH) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI is temporarily unavailable" });
}

// ---- paths.generate ----

export async function generatePath(learnerId: string, topic: string) {
  assertAiEnabled();
  if (!(await isSafeText(topic))) throw new TRPCError({ code: "PRECONDITION_FAILED", message: REFUSAL_COPY });
  if (!env.ENGINE_TOKEN) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI is not configured" });
  const [me] = await db.select({ userId: learners.userId, tier: learners.tier }).from(learners).where(eq(learners.id, learnerId));
  // Every call that reaches the engine takes a slot, so rejected topics count too. The per-user lock makes count-then-insert atomic.
  const slot = await withTx(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${me!.userId}))`);
    const {
      rows: [{ n }],
    } = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ai_generations WHERE user_id = ${me!.userId} AND created_at > now() - interval '24 hours'`);
    if (n >= tiers[me!.tier as keyof typeof tiers].aiPathsPerDay) return null;
    const [row] = await tx.insert(aiGenerations).values({ userId: me!.userId }).returning({ id: aiGenerations.id });
    return row!.id;
  });
  if (!slot) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `You've reached your ${tiers[me!.tier as keyof typeof tiers].aiPathsPerDay} AI paths for today` });
  try {
    await reserveAiSpend(env.AI_CALL_ESTIMATE_USD);
  } catch (e) {
    await db.delete(aiGenerations).where(eq(aiGenerations.id, slot)); // refused before any call: the daily path is not used
    throw e;
  }

  let outline;
  try {
    outline = Outline.parse(await measureGeneration("outline", () => generator.outline(topic)));
    if (!(await isSafeText(JSON.stringify(outline)))) throw new Error("Generated content refused by safety filter");
  } catch {
    console.error("outline generation failed");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't build that path. Try again." });
  }
  if ("refused" in outline) throw new TRPCError({ code: "BAD_REQUEST", message: REFUSAL_COPY });

  try {
    return await persistPath(me!.userId, learnerId, outline);
  } catch (e) {
    // Nothing was saved (e.g. a slug collision): give the daily slot back.
    await db.delete(aiGenerations).where(eq(aiGenerations.id, slot)).catch(() => undefined);
    throw e;
  }
}

async function persistPath(ownerId: string, learnerId: string, outline: Exclude<z.infer<typeof Outline>, { refused: true }>) {
  return withTx(async (tx) => {
    const owned = { ownerId, visibility: "private", origin: "ai" } as const;
    const [path] = await tx
      .insert(paths)
      .values({ slug: slugify(outline.title, 40), title: outline.title, tagline: outline.tagline, ...owned })
      .returning();
    const courseSlugs: string[] = [];
    for (const [position, c] of outline.courses.entries()) {
      const [world] = await tx
        .insert(worlds)
        .values({ slug: slugify(c.title, 40), title: c.title, description: c.description, ...owned })
        .returning();
      courseSlugs.push(world!.slug);
      await tx.insert(pathCourses).values({ pathId: path!.id, worldId: world!.id, position });
      await tx.insert(lessons).values(
        c.lessons.map((l, i) => ({
          slug: slugify(l.title, 40),
          worldId: world!.id,
          title: l.title,
          level: l.level,
          position: i,
          concepts: l.concepts,
          kind: l.kind,
          sourceKind: "ai" as const,
          status: "draft" as const,
        })),
      );
    }
    await tx.insert(enrollments).values({ learnerId, pathId: path!.id });
    return { slug: path!.slug, firstCourseSlug: courseSlugs[0]! };
  });
}

// ---- lazy lesson generation ----

function validate(raw: unknown): GeneratedStep[] {
  const { steps } = Lesson.parse(raw);
  for (const s of steps) {
    const input = { beforeFiles: s.beforeFiles, hunks: s.hunks };
    const tl = buildTimeline([input]); // throws when a hunk does not match its file
    const after = seek(tl, tl.duration).files;
    if (JSON.stringify(after) === JSON.stringify(s.beforeFiles)) throw new Error(`step "${s.title}" changes nothing`);
    if (s.kind === "mcq" && s.hints.some((h) => h.eliminate === s.answer))
      throw new Error(`step "${s.title}": bad eliminate`);
  }
  // shortcut: a step's beforeFiles is not checked against the previous step's result; the prompt asks for it.
  return steps;
}

// Generated text is moderated before it is saved; a flag throws so writeLesson retries. It fails open like topics,
// except for a lesson in a public course: everyone can read that, so it fails closed, as publishing does.
async function moderated<T>(v: T, isPublic: boolean): Promise<T> {
  const text = JSON.stringify(v);
  if (!(await (isPublic ? isSafe(text) : isSafeText(text)))) throw new Error("Generated content refused by safety filter");
  return v;
}

// Bump when a prompt or the engine's part shape changes, so stale cached parts are not reused.
const PART_CACHE_VERSION = 1;

type LessonRow = typeof lessons.$inferSelect;

function partCacheKey(ctx: LessonContext) {
  return createHash("sha256").update(`v${PART_CACHE_VERSION}:${JSON.stringify({ ...ctx, missedConcepts: [] })}`).digest("hex");
}

async function cachedPart(key: string): Promise<PartSecret | null> {
  const [hit] = await db.select({ content: generationCache.content }).from(generationCache).where(eq(generationCache.key, key)).limit(1);
  if (!hit) return null;
  try {
    return validatePart(hit.content);
  } catch {
    return null; // stale or unsafe cache row: regenerate
  }
}

// The result is stored once on the shared lesson (and can become public), so the learner's missed concepts are never part of it.
async function lessonContext(l: LessonRow): Promise<LessonContext> {
  const [world] = await db.select().from(worlds).where(eq(worlds.id, l.worldId));
  const [path] = await db
    .select({ title: paths.title, tagline: paths.tagline })
    .from(pathCourses)
    .innerJoin(paths, eq(paths.id, pathCourses.pathId))
    .where(eq(pathCourses.worldId, l.worldId))
    .limit(1);
  return {
    path: path ?? { title: world!.title, tagline: "" },
    course: { title: world!.title, description: world!.description },
    lesson: { title: l.title, level: l.level, concepts: l.concepts, kind: l.kind },
    missedConcepts: [],
  };
}

type Generated = { part: PartSecret | null; generated: GeneratedStep[] };

// Model calls: no transaction or pooled connection is held while these run.
async function generate(ctx: LessonContext, key: string | null, cached: PartSecret | null, isPublic: boolean): Promise<Generated> {
  // A part keeps its content on the version; a predict lesson keeps one steps row per step.
  // Parts come from the engine and are cached by what produced them, so a repeat lesson makes no model call.
  // A cached part may have been cleared fail-open for a private course, so a public one checks it again.
  let part = cached && isPublic ? await moderated(cached, true) : cached;
  if (key && !part) {
    const partCtx: PartContext = { ...ctx, missedConcepts: [] };
    part = await moderated(validatePart(await measureGeneration("part", () => engineParts.lesson(partCtx))), isPublic);
    await db.insert(generationCache).values({ key, kind: part.kind, content: part }).onConflictDoNothing();
  }
  const generated = key ? [] : await moderated(validate(await measureGeneration("lesson", () => generator.lesson(ctx))), isPublic);
  return { part, generated };
}

// The only transaction: lock the lesson row, re-check it is still unwritten, insert. Short, no network calls.
async function writeOnce(tx: Db, lessonId: string, learnerId: string, { part, generated }: Generated) {
  const [l] = await tx.select().from(lessons).where(eq(lessons.id, lessonId)).for("update");
  if (!l || l.currentVersionId || l.sourceKind !== "ai") return null; // another caller wrote it first: this result is dropped

  const [version] = await tx
    .insert(lessonVersions)
    .values({ lessonId: l.id, version: 1, publishedAt: new Date(), content: part })
    .returning();
  // Images are generated after commit below: their save uses its own connection and cannot see this version yet.
  const prewarm = part && (part.kind === "learn" || part.kind === "game-practice") && part.doc ? part.doc : null;
  const [learner] = prewarm ? await tx.select({ tier: learners.tier }).from(learners).where(eq(learners.id, learnerId)) : [];
  if (!part) {
    await tx.insert(steps).values(
      generated.map((s, idx) => ({
        lessonVersionId: version!.id,
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
      })),
    );
  }
  // Visibility stays governed by the owning course and path.
  await tx.update(lessons).set({ currentVersionId: version!.id, status: "published" }).where(eq(lessons.id, l.id));
  return { lessonVersionId: version!.id, prewarm, tier: learner?.tier as keyof typeof tiers | undefined };
}

// Concurrency design: generation (context, engine/model calls, moderation) runs outside any transaction, so a slow
// model never pins a pooled connection or a row lock. Only the final write locks the lesson row, re-checks
// currentVersionId and inserts, so exactly one version is ever written. Within a process `inflight` shares one
// generation per lesson. Across instances we accept the rare duplicate generation (the loser's result is dropped and
// its reserved budget stays counted: over-counted, never under) rather than hold a dedicated connection for an
// advisory lock for the whole generation, which would reintroduce the pool exhaustion this avoids.
const inflight = new Map<string, Promise<boolean>>();

// Writes the lesson's steps once. Concurrent callers in this process share one in-flight write.
export function ensureLesson(lessonId: string, learnerId: string): Promise<boolean> {
  const running = inflight.get(lessonId);
  if (running) return running;
  const p = writeLesson(lessonId, learnerId).finally(() => inflight.delete(lessonId));
  inflight.set(lessonId, p);
  return p;
}

async function writeLesson(lessonId: string, learnerId: string): Promise<boolean> {
  // Reads outside any transaction, so a written or non-AI lesson returns before any budget is reserved.
  const [pre] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!pre || pre.currentVersionId || pre.sourceKind !== "ai") return false;
  assertAiEnabled();
  const ctx = await lessonContext(pre);
  const [world] = await db.select({ visibility: worlds.visibility }).from(worlds).where(eq(worlds.id, pre.worldId));
  const isPublic = world?.visibility === "public";
  const key = pre.kind === "predict" ? null : partCacheKey(ctx);
  const cached = key ? await cachedPart(key) : null; // a cache hit makes no model call and reserves nothing

  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Before each attempt (a retry is reserved too). An engine part can make several model calls.
    if (!cached) await reserveAiSpend(env.AI_CALL_ESTIMATE_USD * (key ? ENGINE_CALLS_PER_PART : 1));
    try {
      const result = await generate(ctx, key, cached, isPublic);
      const written = await withTx((tx) => writeOnce(tx, lessonId, learnerId, result));
      if (!written) return false;
      // Best-effort and not awaited: the read must not wait on image generation.
      if (written.prewarm) {
        const p: Promise<unknown> = prewarmDocImages(written.prewarm, { lessonVersionId: written.lessonVersionId, learnerId, tier: written.tier! })
          .catch((e) => console.error("prewarm of lesson images failed", e))
          .finally(() => background.delete(p));
        background.add(p);
      }
      return true;
    } catch (e) {
      // Budget and kill-switch errors are final: retrying would not help and would hide the message.
      if (e instanceof TRPCError) throw e;
      last = e;
      console.error(`lesson generation attempt ${attempt + 1} failed`, e);
    }
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't write this lesson. Try again.", cause: last });
}

const background = new Set<Promise<unknown>>();
/** Resolves when background generation has settled (tests). */
export const idle = () => Promise.allSettled([...background]);

// Fire-and-forget: generate the lesson right after `lesson` in its course so it is usually ready.
// Parts are written only when opened (the course page promises no AI is wasted), so only predict lessons prefetch.
// Each lesson read calls this; a learner+lesson pair is checked at most once a minute per process.
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
