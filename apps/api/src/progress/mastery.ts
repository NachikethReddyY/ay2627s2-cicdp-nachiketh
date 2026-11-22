import { createHash } from "node:crypto";
import { playableLesson } from "../access.ts";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { attempts, concepts, lessons, lessonVersions, mastery, recommendations, steps, worlds } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { EngineError } from "../engine-client/client.ts";
import { engineLearner, type BktParams, type NextRequest, type NextResult } from "../engine-client/learner.ts";
import { lessonDone, lessonTotal, listed } from "./shared.ts";

export const MASTERED_AT = 0.95;
export const UNLOCK_AT = 0.8;
const BATCH = 50;
const ENGINE_CALL_TIMEOUT_MS = 8_000;
const CATCH_UP_BUDGET_MS = 12_000;

export type AttemptFacts = { observed: boolean; kind: "mcq" | "cloze" | "skip"; correct: boolean | null; hintsUsed: number };

export function observationOf(a: AttemptFacts): "correct" | "incorrect" | null {
  if (!a.observed) return null;
  if (a.kind !== "skip" && a.correct === true && a.hintsUsed === 0) return "correct";
  return "incorrect";
}

export const slugOf = (name: string) => name.trim().toLowerCase();

const MAX_CONCEPT_LEN = 100;
const MAX_CONCEPTS_PER_STEP = 50;

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

export const BKT_DEFAULTS: BktParams = { pSlip: 0.1, pLearn: 0.2, pInit: 0.2 };
const BKT_RANGES: Record<keyof BktParams, (v: number) => boolean> = {
  pSlip: (v) => v > 0 && v < 0.5,
  pLearn: (v) => v >= 0 && v <= 1,
  pInit: (v) => v >= 0 && v <= 1,
};

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

const TRANSIENT_PG_CODES = new Set(["40001", "40P01", "55P03", "57014"]);
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

function conceptNames(stepConcepts: unknown, lessonConcepts: string[], where: string) {
  const own = validConcepts(stepConcepts, where);
  const source = own.length ? own : validConcepts(lessonConcepts, where);
  const bySlug = new Map<string, string>();
  for (const c of source) if (slugOf(c)) bySlug.set(slugOf(c), c.trim());
  return bySlug;
}

export const resolveConcepts = (stepConcepts: unknown, lessonConcepts: string[], where: string): string[] => [
  ...conceptNames(stepConcepts, lessonConcepts, where).values(),
];

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

async function recommendationInput(tx: Db, learnerId: string, worldId: string) {
  const worldLessons = await tx
    .select({ id: lessons.id, kind: lessons.kind, title: lessons.title, concepts: lessons.concepts })
    .from(lessons)
    .where(
      and(
        eq(lessons.worldId, worldId),
        playableLesson(lessons),
      ),
    )
    .orderBy(asc(lessons.level), asc(lessons.position), asc(lessons.slug));
  const names = new Map<string, string>();
  for (const l of worldLessons) for (const c of validConcepts(l.concepts, `lesson ${l.id}`)) if (slugOf(c)) names.set(slugOf(c), c.trim());
  const ids = await ensureConcepts(tx, worldId, names);

  const { rows } = await tx.execute<{ id: string; done: number; total: number }>(sql`
    SELECT l.id, ${lessonDone(learnerId)} AS done, ${lessonTotal} AS total
    FROM lessons l WHERE l.world_id = ${worldId} AND ${listed}`);
  const complete = new Set(rows.filter((r) => r.total > 0 && r.done >= r.total).map((r) => r.id));

  const known = await tx
    .select({ conceptId: mastery.conceptId, slug: concepts.slug, pKnown: mastery.pKnown })
    .from(mastery)
    .innerJoin(concepts, eq(concepts.id, mastery.conceptId))
    .where(and(eq(mastery.learnerId, learnerId), eq(concepts.worldId, worldId)))
    .orderBy(asc(concepts.slug));

  const idOfSlug = new Map(ids);
  for (const k of known) idOfSlug.set(k.slug, k.conceptId);

  const [world] = await tx.select({ title: worlds.title }).from(worlds).where(eq(worlds.id, worldId));
  const worldTitle = world?.title.trim() ?? "";
  const request: NextRequest = {
    mastery: known.map((k) => ({ conceptId: k.slug, pKnown: k.pKnown })),
    edges: [],
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
  const inputHash = hashInput(request);
  return { request, idOfSlug, inputHash, current: latest?.inputHash === inputHash };
}

async function recommend(learnerId: string, worldId: string): Promise<void> {
  const snapshot = await withTx(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM learners WHERE id = ${learnerId} FOR NO KEY UPDATE`);
    return recommendationInput(tx, learnerId, worldId);
  });
  if (snapshot.current) return;
  const next = await engineLearner.next(snapshot.request, { timeoutMs: ENGINE_CALL_TIMEOUT_MS });
  const result = { ...next, conceptId: next.conceptId ? (snapshot.idOfSlug.get(next.conceptId) ?? null) : null };
  await withTx(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM learners WHERE id = ${learnerId} FOR NO KEY UPDATE`);
    const current = await recommendationInput(tx, learnerId, worldId);
    if (current.inputHash === snapshot.inputHash && !current.current)
      await insertRecommendation(tx, learnerId, worldId, result, snapshot.inputHash);
  });
}

export const POLICY_VERSION = "5";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort(byCodeUnit).filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

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

const inFlight = new Map<string, Promise<void>>();

export async function applyObservations(learnerId: string, opts: { worldId?: string } = {}): Promise<void> {
  const previous = inFlight.get(learnerId);
  if (previous) {
    await previous;
    await applyObservations(learnerId, opts);
    return;
  }
  const work = processObservations(learnerId, opts);
  inFlight.set(learnerId, work);
  try {
    await work;
  } finally {
    inFlight.delete(learnerId);
  }
}

async function processObservations(learnerId: string, opts: { worldId?: string }): Promise<void> {
  const started = Date.now();
  const touched = new Set<string>();
  for (let count = 0; count < BATCH && Date.now() - started <= CATCH_UP_BUDGET_MS; count++) {
    const snapshot = await withTx(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM learners WHERE id = ${learnerId} FOR NO KEY UPDATE`);
      const [a] = await tx.select({
        id: attempts.id, observed: attempts.observed, attemptKind: attempts.kind,
        correct: attempts.correct, hintsUsed: attempts.hintsUsed,
        questionType: sql<"mcq" | "cloze">`${steps.public}->>'kind'`,
        stepConcepts: sql<unknown>`${steps.secret}->'concepts'`,
        lessonConcepts: lessons.concepts, worldId: lessons.worldId, config: worlds.config,
      }).from(attempts)
        .innerJoin(steps, eq(steps.id, attempts.stepId))
        .innerJoin(lessonVersions, eq(lessonVersions.id, steps.lessonVersionId))
        .innerJoin(lessons, eq(lessons.id, lessonVersions.lessonId))
        .innerJoin(worlds, eq(worlds.id, lessons.worldId))
        .where(and(eq(attempts.learnerId, learnerId), eq(attempts.observed, true), isNull(attempts.masteryAppliedAt)))
        .orderBy(asc(attempts.createdAt), asc(attempts.id)).limit(1);
      if (!a) return null;
      const names = conceptNames(a.stepConcepts, a.lessonConcepts, `attempt ${a.id}`);
      const ids = await ensureConcepts(tx, a.worldId, names);
      const conceptIds = [...ids.values()];
      const priors = conceptIds.length ? await tx.select({ conceptId: mastery.conceptId, pKnown: mastery.pKnown, nObs: mastery.nObs })
        .from(mastery).where(and(eq(mastery.learnerId, learnerId), inArray(mastery.conceptId, conceptIds))) : [];
      return { a, conceptIds, priors };
    });
    if (!snapshot) break;
    const { a, conceptIds, priors } = snapshot;
    const obs = observationOf({ observed: a.observed, kind: a.attemptKind, correct: a.correct, hintsUsed: a.hintsUsed });
    let updates: Awaited<ReturnType<typeof engineLearner.update>> = [];
    try {
      if (obs && conceptIds.length) {
        const prior = new Map(priors.map((p) => [p.conceptId, p.pKnown]));
        const bkt = mergeBkt((a.config as { bkt?: unknown } | null)?.bkt, `world ${a.worldId}`);
        updates = await engineLearner.update({
          priors: conceptIds.map((conceptId) => ({ conceptId, pKnown: prior.get(conceptId) ?? null })),
          ...(bkt && { params: bkt }), questionType: a.questionType, correct: obs === "correct",
        }, { timeoutMs: ENGINE_CALL_TIMEOUT_MS });
      }
    } catch (e) {
      if (isTransient(e)) {
        console.error(`mastery: attempt ${a.id} will be retried`, e);
        break;
      }
      console.error(`mastery: attempt ${a.id} failed and is skipped`, e);
    }
    const applied = await withTx(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM learners WHERE id = ${learnerId} FOR NO KEY UPDATE`);
      const [pending] = await tx.select({ id: attempts.id }).from(attempts)
        .where(and(eq(attempts.id, a.id), isNull(attempts.masteryAppliedAt)));
      if (!pending) return false;
      const current = conceptIds.length ? await tx.select({ conceptId: mastery.conceptId, pKnown: mastery.pKnown, nObs: mastery.nObs })
        .from(mastery).where(and(eq(mastery.learnerId, learnerId), inArray(mastery.conceptId, conceptIds))) : [];
      const versions = new Map(current.map((p) => [p.conceptId, p.nObs]));
      if (current.length !== priors.length || priors.some((p) => versions.get(p.conceptId) !== p.nObs)) return false;
      for (const u of updates) {
        await tx.insert(mastery).values({ learnerId, conceptId: u.conceptId, pKnown: u.pNext, nObs: 1 })
          .onConflictDoUpdate({ target: [mastery.learnerId, mastery.conceptId],
            set: { pKnown: u.pNext, nObs: sql`${mastery.nObs} + 1`, updatedAt: new Date() } });
      }
      await tx.update(attempts).set({ masteryAppliedAt: new Date() }).where(eq(attempts.id, a.id));
      return true;
    });
    if (applied && updates.length) touched.add(a.worldId);
  }
  for (const worldId of new Set([...touched, ...(opts.worldId ? [opts.worldId] : [])])) {
    if (Date.now() - started > CATCH_UP_BUDGET_MS) break;
    try {
      await recommend(learnerId, worldId);
    } catch (e) {
      console.error(`mastery: recommendation for world ${worldId} failed`, e);
    }
  }
}
