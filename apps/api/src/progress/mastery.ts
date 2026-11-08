import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { attempts, concepts, lessons, lessonVersions, mastery, recommendations, steps, worlds } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { EngineError } from "../engine-client/client.ts";
import { engineLearner, type BktParams, type NextRequest, type NextResult } from "../engine-client/learner.ts";
import { lessonDone, lessonTotal } from "./shared.ts";

export const MASTERED_AT = 0.95;
export const UNLOCK_AT = 0.8;
const BATCH = 50;

export type AttemptFacts = { observed: boolean; kind: "mcq" | "cloze" | "skip"; correct: boolean | null; hintsUsed: number };

/**
 * Maps an attempt to a BKT observation. Only the first action on a step counts: clean correct is a success;
 * a wrong answer, a hint-assisted answer or a skip is a failure. Anything else makes no observation.
 */
export function observationOf(a: AttemptFacts): "correct" | "incorrect" | null {
  if (!a.observed) return null;
  if (a.kind !== "skip" && a.correct === true && a.hintsUsed === 0) return "correct";
  return "incorrect";
}

export const slugOf = (name: string) => name.trim().toLowerCase();

const MAX_CONCEPT_LEN = 100;
const MAX_CONCEPTS_PER_STEP = 50;

/** Keeps the engine's limits on concepts: strings only, at most 100 characters, at most 50 per list. Logs what it drops. */
function validConcepts(raw: unknown, where: string): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    console.warn(`mastery: ${where} concepts is not a list; ignored`);
    return [];
  }
  const ok = raw.filter((c): c is string => typeof c === "string" && c.trim().length <= MAX_CONCEPT_LEN);
  const kept = ok.slice(0, MAX_CONCEPTS_PER_STEP);
  if (kept.length < raw.length) console.warn(`mastery: ${where} dropped ${raw.length - kept.length} invalid concept(s)`);
  return kept;
}

/** Engine defaults (services/engine bkt.py) for the parameters a world may override. */
export const BKT_DEFAULTS: BktParams = { pSlip: 0.1, pLearn: 0.2, pInit: 0.2 };
/** The engine's ranges: pSlip in (0, 0.5), pLearn and pInit in [0, 1]. */
const BKT_RANGES: Record<keyof BktParams, (v: number) => boolean> = {
  pSlip: (v) => v > 0 && v < 0.5,
  pLearn: (v) => v >= 0 && v <= 1,
  pInit: (v) => v >= 0 && v <= 1,
};

/**
 * Merges a world's config.bkt over the engine defaults, field by field. An invalid field falls back to its
 * default (logged). pGuess is never sent: the engine picks it by question type, so a configured one is ignored.
 * Returns undefined when the world configures nothing, so the engine uses its own defaults.
 */
export function mergeBkt(raw: unknown, where: string): BktParams | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    console.warn(`mastery: ${where} bkt config is not an object; using engine defaults`);
    return undefined;
  }
  const cfg = raw as Record<string, unknown>;
  if ("pGuess" in cfg) console.warn(`mastery: ${where} sets pGuess; ignored (the engine picks it by question type)`);
  const out = { ...BKT_DEFAULTS };
  for (const key of Object.keys(BKT_RANGES) as (keyof BktParams)[]) {
    if (!(key in cfg)) continue;
    const v = cfg[key];
    if (typeof v === "number" && Number.isFinite(v) && BKT_RANGES[key](v)) out[key] = v;
    else console.warn(`mastery: ${where} has invalid ${key}; using default ${BKT_DEFAULTS[key]}`);
  }
  return out;
}

/**
 * Transient trouble is retried later: the engine answering 5xx, 408 or 429, or being unreachable (the client
 * reports that as EngineError 502). Transient database errors (see TRANSIENT_PG_CODES) count too. Anything else (other database errors, invalid engine responses, bugs) will not
 * get better by waiting, so the row is skipped.
 */
/** Postgres: serialization_failure, deadlock_detected, lock_not_available, query_canceled. */
const TRANSIENT_PG_CODES = new Set(["40001", "40P01", "55P03", "57014"]);
/** node-postgres puts the SQLSTATE on `code`; drizzle may wrap the driver error in `cause`. */
const pgCode = (e: unknown): string | undefined => {
  for (let cur: unknown = e, i = 0; cur && typeof cur === "object" && i < 3; cur = (cur as { cause?: unknown }).cause, i++) {
    const c = (cur as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return undefined;
};
const isTransient = (e: unknown) =>
  (e instanceof EngineError && (e.status >= 500 || e.status === 408 || e.status === 429)) ||
  TRANSIENT_PG_CODES.has(pgCode(e) ?? "");

/**
 * Distinct concept names, trimmed, keyed by slug. A step's own list wins over its lesson's.
 * Concept names are public labels: they appear in attempt feedback (missedConcepts) and in me.mastery, so
 * they must never hold anything secret (answers, hints).
 */
function conceptNames(stepConcepts: unknown, lessonConcepts: string[], where: string) {
  const own = validConcepts(stepConcepts, where);
  const source = own.length ? own : validConcepts(lessonConcepts, where);
  const bySlug = new Map<string, string>();
  for (const c of source) if (slugOf(c)) bySlug.set(slugOf(c), c.trim());
  return bySlug;
}

/** The concept names an attempt on a step touches, resolved the same way mastery does (step first, then lesson). */
export const resolveConcepts = (stepConcepts: unknown, lessonConcepts: string[], where: string): string[] => [
  ...conceptNames(stepConcepts, lessonConcepts, where).values(),
];

/** Inserts missing concepts for the world and returns slug -> id. */
async function ensureConcepts(tx: Db, worldId: string, names: Map<string, string>) {
  if (names.size === 0) return new Map<string, string>();
  await tx
    .insert(concepts)
    .values([...names].map(([slug, name]) => ({ worldId, slug, name })))
    .onConflictDoNothing();
  const rows = await tx
    .select({ id: concepts.id, slug: concepts.slug })
    .from(concepts)
    .where(and(eq(concepts.worldId, worldId), inArray(concepts.slug, [...names.keys()])));
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/** Asks the engine what comes next in the world and stores it when it is new information. */
async function recommend(tx: Db, learnerId: string, worldId: string): Promise<void> {
  const worldLessons = await tx
    .select({ id: lessons.id, kind: lessons.kind, title: lessons.title, concepts: lessons.concepts })
    .from(lessons)
    .where(and(eq(lessons.worldId, worldId), eq(lessons.status, "published")))
    .orderBy(asc(lessons.level), asc(lessons.position), asc(lessons.slug));
  const names = new Map<string, string>();
  for (const l of worldLessons) for (const c of validConcepts(l.concepts, `lesson ${l.id}`)) if (slugOf(c)) names.set(slugOf(c), c.trim());
  const ids = await ensureConcepts(tx, worldId, names);

  const { rows } = await tx.execute<{ id: string; done: number; total: number }>(sql`
    SELECT l.id, ${lessonDone(learnerId)} AS done, ${lessonTotal} AS total
    FROM lessons l WHERE l.world_id = ${worldId} AND l.status = 'published'`);
  const complete = new Set(rows.filter((r) => r.total > 0 && r.done >= r.total).map((r) => r.id));

  const known = await tx
    .select({ conceptId: mastery.conceptId, slug: concepts.slug, pKnown: mastery.pKnown })
    .from(mastery)
    .innerJoin(concepts, eq(concepts.id, mastery.conceptId))
    .where(and(eq(mastery.learnerId, learnerId), eq(concepts.worldId, worldId)));

  // The engine sees slugs, not UUIDs, so its reason text is readable. Slugs are unique per world.
  const idOfSlug = new Map(ids);
  for (const k of known) idOfSlug.set(k.slug, k.conceptId);

  const [world] = await tx.select({ title: worlds.title }).from(worlds).where(eq(worlds.id, worldId));
  const worldTitle = world?.title.trim() ?? "";
  const request: NextRequest = {
    mastery: known.map((k) => ({ conceptId: k.slug, pKnown: k.pKnown })),
    edges: [], // no prerequisite edges exist yet, so every concept counts as unlocked
    lessons: worldLessons.map((l, order) => ({
      lessonId: l.id,
      ...(l.title.trim() && { title: l.title.trim() }),
      conceptIds: [...new Set(l.concepts.map(slugOf).filter((slug) => ids.has(slug)))],
      kind: l.kind,
      done: complete.has(l.id),
      order,
    })),
    ...(worldTitle && { worldTitle }),
    unlockAt: UNLOCK_AT,
    masteredAt: MASTERED_AT,
  };

  const [latest] = await tx
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.learnerId, learnerId), eq(recommendations.worldId, worldId)))
    .orderBy(desc(recommendations.createdAt), desc(recommendations.id))
    .limit(1);
  // Nothing the engine sees has changed since the stored recommendation, so asking again cannot tell us more.
  const inputHash = hashInput(request);
  if (latest?.inputHash === inputHash) return;

  const next = await engineLearner.next(request);
  const result = { ...next, conceptId: next.conceptId ? (idOfSlug.get(next.conceptId) ?? null) : null };
  await insertRecommendation(tx, learnerId, worldId, result, inputHash);
}

/**
 * Bump together with POLICY_VERSION in services/engine/learnquest_engine/policy.py (a test keeps them equal).
 * It is part of the cache hash, so a policy or reason-text change invalidates stored recommendations.
 */
export const POLICY_VERSION = "2";

/** Code-unit order, not localeCompare: the hash must not depend on the host's locale. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** JSON with object keys sorted at every level, so equal values always serialise equally. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort(byCodeUnit).filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** sha256 over the whole /v1/next request plus the policy version: anything the engine sees can change the answer. */
function hashInput(r: NextRequest): string {
  return createHash("sha256").update(stableStringify({ policyVersion: POLICY_VERSION, request: r })).digest("hex");
}

const insertRecommendation = (tx: Db, learnerId: string, worldId: string, r: NextResult, inputHash: string) =>
  tx.insert(recommendations).values({
    learnerId,
    worldId,
    lessonId: r.lessonId,
    conceptId: r.conceptId,
    action: r.action,
    reasonCode: r.reasonCode,
    reason: r.reason,
    inputHash,
  });

/**
 * Applies up to 50 pending observed attempts to the learner's mastery, then records a fresh recommendation for
 * every world that changed (and for `worldId`, when it differs from the latest stored one). One transaction,
 * serialised per learner by a row lock; mastery_applied_at makes it idempotent. Each row runs in a savepoint:
 * a row that can never succeed is logged and marked applied so it cannot block the learner; transient engine
 * trouble stops the batch and leaves the row (and later ones) pending. Earlier writes are kept either way.
 */
export async function applyObservations(learnerId: string, opts: { worldId?: string } = {}): Promise<void> {
  await withTx(async (tx) => {
    // NO KEY UPDATE still serialises concurrent calls but, unlike FOR UPDATE, does not conflict with the
    // FOR KEY SHARE lock that inserts into step_progress, attempts and hint_events take on this row.
    await tx.execute(sql`SELECT 1 FROM learners WHERE id = ${learnerId} FOR NO KEY UPDATE`);
    const pending = await tx
      .select({
        id: attempts.id,
        observed: attempts.observed,
        attemptKind: attempts.kind,
        correct: attempts.correct,
        hintsUsed: attempts.hintsUsed,
        questionType: sql<"mcq" | "cloze">`${steps.public}->>'kind'`,
        stepConcepts: sql<unknown>`${steps.secret}->'concepts'`,
        lessonConcepts: lessons.concepts,
        worldId: lessons.worldId,
        config: worlds.config,
      })
      .from(attempts)
      .innerJoin(steps, eq(steps.id, attempts.stepId))
      .innerJoin(lessonVersions, eq(lessonVersions.id, steps.lessonVersionId))
      .innerJoin(lessons, eq(lessons.id, lessonVersions.lessonId))
      .innerJoin(worlds, eq(worlds.id, lessons.worldId))
      .where(and(eq(attempts.learnerId, learnerId), eq(attempts.observed, true), isNull(attempts.masteryAppliedAt)))
      .orderBy(asc(attempts.createdAt), asc(attempts.id))
      .limit(BATCH);

    const touched = new Set<string>();
    for (const a of pending) {
      const obs = observationOf({ observed: a.observed, kind: a.attemptKind, correct: a.correct, hintsUsed: a.hintsUsed });
      const where = `attempt ${a.id}`;
      await tx.execute(sql`SAVEPOINT mastery_row`);
      try {
        const names = conceptNames(a.stepConcepts, a.lessonConcepts, where);
        if (obs && names.size === 0) console.warn(`mastery: ${where} has no concepts; no observation made`);
        if (obs && names.size > 0) {
          const ids = await ensureConcepts(tx, a.worldId, names);
          const conceptIds = [...ids.values()];
          const priors = await tx
            .select({ conceptId: mastery.conceptId, pKnown: mastery.pKnown })
            .from(mastery)
            .where(and(eq(mastery.learnerId, learnerId), inArray(mastery.conceptId, conceptIds)));
          const prior = new Map(priors.map((p) => [p.conceptId, p.pKnown]));
          const bkt = mergeBkt((a.config as { bkt?: unknown } | null)?.bkt, `world ${a.worldId}`);
          const updates = await engineLearner.update({
            priors: conceptIds.map((conceptId) => ({ conceptId, pKnown: prior.get(conceptId) ?? null })),
            ...(bkt && { params: bkt }),
            questionType: a.questionType,
            correct: obs === "correct",
          });
          for (const u of updates) {
            await tx
              .insert(mastery)
              .values({ learnerId, conceptId: u.conceptId, pKnown: u.pNext, nObs: 1 })
              .onConflictDoUpdate({
                target: [mastery.learnerId, mastery.conceptId],
                set: { pKnown: u.pNext, nObs: sql`${mastery.nObs} + 1`, updatedAt: new Date() },
              });
          }
          touched.add(a.worldId);
        }
        await tx.execute(sql`RELEASE SAVEPOINT mastery_row`);
      } catch (e) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT mastery_row`);
        if (isTransient(e)) {
          console.error(`mastery: ${where} will be retried`, e);
          break;
        }
        console.error(`mastery: ${where} failed and is skipped`, e);
      }
      await tx.update(attempts).set({ masteryAppliedAt: new Date() }).where(eq(attempts.id, a.id));
    }

    // Recompute for changed worlds and for the requested world; recommend() skips the engine when its inputs match the stored hash.
    // The engine can fail here without losing the mastery writes above.
    const want = new Set([...touched, ...(opts.worldId ? [opts.worldId] : [])]);
    for (const worldId of want) {
      await tx.execute(sql`SAVEPOINT recommend`);
      try {
        await recommend(tx, learnerId, worldId);
        await tx.execute(sql`RELEASE SAVEPOINT recommend`);
      } catch (e) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT recommend`);
        console.error(`mastery: recommendation for world ${worldId} failed`, e);
      }
    }
  });
}
