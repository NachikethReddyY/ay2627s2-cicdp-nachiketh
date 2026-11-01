import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildTimeline, seek } from "@learnquest/player-core";
import { db } from "../db/client.ts";
import { withTx } from "../db/tx.ts";
import { env } from "../env.ts";
import { aiGenerations, enrollments, learners, lessons, lessonVersions, pathCourses, paths, steps, worlds } from "../db/schema.ts";
import { generator, type LessonContext } from "./generator.ts";

const text = (max: number) => z.string().trim().min(1).max(max);
const Outline = z.union([
  z.object({ notCoding: z.literal(true) }),
  z.object({
    title: text(80),
    tagline: text(160),
    courses: z
      .array(
        z.object({
          title: text(80),
          description: text(300),
          lessons: z
            .array(z.object({ title: text(80), level: z.number().int().min(1).max(5), concepts: z.array(text(60)).min(1).max(6) }))
            .min(3)
            .max(6),
        }),
      )
      .min(2)
      .max(4),
  }),
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
  `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max) || "x"}-${randomBytes(3).toString("hex")}`;

// ---- paths.generate ----

export async function generatePath(learnerId: string, topic: string) {
  if (!env.ANTHROPIC_API_KEY) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI is not configured" });
  const [me] = await db.select({ userId: learners.userId }).from(learners).where(eq(learners.id, learnerId));
  // Every call that reaches Claude takes a slot, so rejected topics count too. The per-user lock makes count-then-insert atomic.
  const allowed = await withTx(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${me!.userId}))`);
    const {
      rows: [{ n }],
    } = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ai_generations WHERE user_id = ${me!.userId} AND created_at > now() - interval '24 hours'`);
    if (n >= 5) return false;
    await tx.insert(aiGenerations).values({ userId: me!.userId });
    return true;
  });
  if (!allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "You can build 5 AI paths per day" });

  let outline;
  try {
    outline = Outline.parse(await generator.outline(topic));
  } catch (e) {
    console.error("outline generation failed", e);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't build that path. Try again." });
  }
  if ("notCoding" in outline) throw new TRPCError({ code: "BAD_REQUEST", message: "LearnQuest paths are for coding topics" });

  return withTx(async (tx) => {
    const owned = { ownerId: me!.userId, visibility: "private", origin: "ai" } as const;
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

async function writeSteps(ctx: LessonContext): Promise<GeneratedStep[]> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return validate(await generator.lesson(ctx));
    } catch (e) {
      last = e;
      console.error(`lesson generation attempt ${attempt + 1} failed`, e);
    }
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't write this lesson. Try again.", cause: last });
}

// Writes the lesson's steps once. The row lock is held across the Claude call, so concurrent callers wait,
// then see the version and return. shortcut: this holds one pool connection for the call's duration.
export async function ensureLesson(lessonId: string, learnerId: string) {
  return withTx(async (tx) => {
    const [l] = await tx.select().from(lessons).where(eq(lessons.id, lessonId)).for("update");
    if (!l || l.currentVersionId || l.sourceKind !== "ai") return false;

    const [world] = await tx.select().from(worlds).where(eq(worlds.id, l.worldId));
    const [path] = await tx
      .select({ title: paths.title, tagline: paths.tagline })
      .from(pathCourses)
      .innerJoin(paths, eq(paths.id, pathCourses.pathId))
      .where(eq(pathCourses.worldId, l.worldId))
      .limit(1);
    const { rows } = await tx.execute<{ c: string }>(sql`
      SELECT DISTINCT c FROM (SELECT unnest(missed_concepts) AS c, created_at FROM attempts
        WHERE learner_id = ${learnerId} ORDER BY created_at DESC LIMIT 40) t LIMIT 10`);
    const generated = await writeSteps({
      path: path ?? { title: world!.title, tagline: "" },
      course: { title: world!.title, description: world!.description },
      lesson: { title: l.title, level: l.level, concepts: l.concepts },
      missedConcepts: rows.map((r) => r.c),
    });

    const [version] = await tx
      .insert(lessonVersions)
      .values({ lessonId: l.id, version: 1, publishedAt: new Date() })
      .returning();
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
    // Visibility stays governed by the owning course and path.
    await tx.update(lessons).set({ currentVersionId: version!.id, status: "published" }).where(eq(lessons.id, l.id));
    return true;
  });
}

const background = new Set<Promise<unknown>>();
/** Resolves when background generation has settled (tests). */
export const idle = () => Promise.allSettled([...background]);

// Fire-and-forget: generate the lesson right after `lesson` in its course so it is usually ready.
export function prefetchNext(lesson: typeof lessons.$inferSelect, learnerId: string) {
  const p = (async () => {
    const [next] = await db
      .select({ id: lessons.id, v: lessons.currentVersionId })
      .from(lessons)
      .where(
        and(
          eq(lessons.worldId, lesson.worldId),
          sql`(${lessons.level}, ${lessons.position}, ${lessons.id}) > (${lesson.level}, ${lesson.position}, ${lesson.id})`,
        ),
      )
      .orderBy(asc(lessons.level), asc(lessons.position), asc(lessons.id))
      .limit(1);
    if (next && !next.v) await ensureLesson(next.id, learnerId);
  })()
    .catch((e) => console.error("prefetch of next lesson failed", e))
    .finally(() => background.delete(p));
  background.add(p);
}
