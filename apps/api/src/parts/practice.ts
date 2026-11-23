import { createHash, createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, type Db } from "../db/client.ts";
import { practiceAttempts } from "../db/schema.ts";
import { env } from "../env.ts";
import { lessonRef, meUser, playableLesson, visibleWorld } from "../access.ts";
import { parsePractice, type Practice } from "./practice-schema.ts";
import { loadScrimGates } from "../lessons/scrim-gates.ts";
import { scrimLabLocked } from "../lessons/scrim.ts";

export const PRACTICE_REVEAL_ATTEMPTS = 3;

export function practiceOf(content: unknown): Practice | null {
  if (typeof content !== "object" || content === null || !("kind" in content)) return null;
  if (content.kind === "practice") return parsePractice(content);
  if (content.kind === "scrim" && "lab" in content) return parsePractice(content.lab);
  return null;
}

export type PracticeCheck = { expected: string; record: () => Promise<void> };

export async function practiceCheck(learnerId: string, lessonId: string): Promise<PracticeCheck | null> {
  const {
    rows: [lesson],
  } = await db.execute<{ id: string; version_id: string; kind: "practice" | "scrim"; expected: string | null }>(sql`
    SELECT l.id, v.id AS version_id, l.kind, COALESCE(v.content->>'expectedOutput', v.content->'lab'->>'expectedOutput') AS expected FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    JOIN lesson_versions v ON v.id = l.current_version_id
    WHERE ${lessonRef(lessonId)}
      AND ${playableLesson()}
      AND l.kind IN ('practice', 'scrim')
      AND v.content->>'kind' = l.kind
      AND (l.kind = 'practice' OR v.content->'lab'->'tests' IS NULL)
      AND ${visibleWorld(meUser)}`);
  if (!lesson || lesson.expected === null) return null;
  if (lesson.kind === "scrim") {
    const { scrim, gates } = await loadScrimGates(lesson.version_id, learnerId);
    if (scrimLabLocked(scrim, gates)) return null;
  }
  return {
    expected: lesson.expected,
    record: async () => { await recordCompletion(learnerId, lesson.id); },
  };
}

export function practiceContentKey(practice: Practice): string {
  const { referenceSolutionVerified: _verified, ...content } = practice;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function practiceRevision(versionId: string, practice: Practice): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`practice:${versionId}:${practiceContentKey(practice)}`).digest("hex");
}

type PracticeLesson = { lessonId: string; versionId: string; kind: "practice" | "scrim"; practice: Practice };

export async function practiceTests(learnerId: string, lessonId: string, tx?: Db): Promise<PracticeLesson | null> {
  const {
    rows: [lesson],
  } = await (tx ?? db).execute<{ id: string; version_id: string; kind: PracticeLesson["kind"]; content: unknown }>(sql`
    SELECT l.id, v.id AS version_id, l.kind, v.content FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    JOIN lesson_versions v ON v.id = l.current_version_id
    WHERE ${lessonRef(lessonId)}
      AND ${playableLesson()}
      AND l.kind IN ('practice', 'scrim')
      AND v.content->>'kind' = l.kind
      AND ${visibleWorld(meUser)}
    ${tx ? sql`FOR SHARE OF l, w, v` : sql``}`);
  const practice = lesson ? practiceOf(lesson.content) : null;
  return lesson && practice ? { lessonId: lesson.id, versionId: lesson.version_id, kind: lesson.kind, practice } : null;
}

export async function countPracticeAttempts(learnerId: string, versionId: string, practice: Practice, connection = db): Promise<number> {
  const [row] = await connection.select({ count: practiceAttempts.count }).from(practiceAttempts)
    .where(and(eq(practiceAttempts.learnerId, learnerId), eq(practiceAttempts.lessonVersionId, versionId), eq(practiceAttempts.contentKey, practiceContentKey(practice))));
  return row?.count ?? 0;
}

export async function recordPracticeAttempt(tx: Db, learnerId: string, versionId: string, contentKey: string): Promise<number> {
  const [row] = await tx.insert(practiceAttempts).values({ learnerId, lessonVersionId: versionId, contentKey, count: 1 })
    .onConflictDoUpdate({
      target: [practiceAttempts.learnerId, practiceAttempts.lessonVersionId, practiceAttempts.contentKey],
      set: { count: sql`${practiceAttempts.count} + 1` },
    })
    .returning({ count: practiceAttempts.count });
  return row.count;
}

export async function recordCompletion(learnerId: string, lessonId: string, connection = db): Promise<boolean> {
  const { rows } = await connection.execute(sql`
    INSERT INTO part_completions (learner_id, lesson_id) VALUES (${learnerId}, ${lessonId})
    ON CONFLICT DO NOTHING RETURNING lesson_id`);
  return rows.length > 0;
}
