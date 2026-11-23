import { createHash } from "node:crypto";
import { playableLesson } from "../access.ts";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { concepts, lessons, mastery, recommendations, worlds } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { engineLearner, type BktParams, type NextRequest, type NextResult, type UpdateRequest } from "../engine-client/learner.ts";
import { catalogueName, edgesFor, isCatalogueConcept, unmetPrerequisites } from "./catalogue.ts";
import { lessonDone, lessonTotal, listed } from "./shared.ts";

export const MASTERED_AT = 0.95;
export const UNLOCK_AT = 0.8;
const BATCH = 50;
const ENGINE_CALL_TIMEOUT_MS = 8_000;
const CATCH_UP_BUDGET_MS = 12_000;

export type AttemptFacts = { observed: boolean; kind: UpdateRequest["questionType"] | "skip"; correct: boolean | null; hintsUsed: number };

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

function conceptNames(raw: unknown, where: string) {
  const source = validConcepts(raw, where);
  const bySlug = new Map<string, string>();
  for (const c of source) if (slugOf(c)) bySlug.set(slugOf(c), c.trim());
  return bySlug;
}

export const resolveConcepts = (raw: unknown, where: string): string[] => [
  ...conceptNames(raw, where).values(),
];

async function ensureConcepts(tx: Db, worldId: string, names: Map<string, string>) {
  if (names.size === 0) return new Map<string, string>();
  await tx
    .insert(concepts)
    .values([...names].map(([slug, name]) => ({ worldId: isCatalogueConcept(slug) ? null : worldId, slug, name: catalogueName(slug) ?? name })))
    .onConflictDoNothing();
  const rows = await tx
    .select({ id: concepts.id, slug: concepts.slug, worldId: concepts.worldId })
    .from(concepts)
    .where(and(or(eq(concepts.worldId, worldId), isNull(concepts.worldId)), inArray(concepts.slug, [...names.keys()])));
  return new Map(rows.filter((r) => isCatalogueConcept(r.slug) === (r.worldId === null)).map((r) => [r.slug, r.id]));
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

  const [world] = await tx.select({ title: worlds.title, config: worlds.config }).from(worlds).where(eq(worlds.id, worldId));
  const worldTitle = world?.title.trim() ?? "";
  const edges = edgesFor(world?.config, names.keys());
  const relevant = new Set([...names.keys(), ...edges.flat()]);
  const known = await tx
    .select({ conceptId: mastery.conceptId, slug: concepts.slug, pKnown: mastery.pKnown, worldId: concepts.worldId })
    .from(mastery)
    .innerJoin(concepts, eq(concepts.id, mastery.conceptId))
    .where(and(eq(mastery.learnerId, learnerId), or(eq(concepts.worldId, worldId), isNull(concepts.worldId))))
    .orderBy(asc(concepts.slug));
  const relevantMastery = known.filter((k) => relevant.has(k.slug) && isCatalogueConcept(k.slug) === (k.worldId === null));
  const idOfSlug = new Map(ids);
  for (const k of relevantMastery) idOfSlug.set(k.slug, k.conceptId);
  const pKnown = new Map(relevantMastery.map((k) => [k.slug, k.pKnown]));
  const request: NextRequest = {
    mastery: relevantMastery.map((k) => ({ conceptId: k.slug, pKnown: k.pKnown })),
    edges,
    lessons: worldLessons.map((l, order) => ({
      lessonId: l.id,
      ...(l.title.trim() && { title: l.title.trim() }),
      conceptIds: [...new Set(l.concepts.map(slugOf).filter((slug) => ids.has(slug)))],
      kind: l.kind,
      available: unmetPrerequisites(l.concepts.map(slugOf), new Set(names.keys()), edges, pKnown, UNLOCK_AT).length === 0,
      done: complete.has(l.id),
      order,
    })),
    ...(worldTitle && { worldTitle }),
    unlockAt: UNLOCK_AT,
    masteredAt: MASTERED_AT,
  };

  const [latest] = await tx
    .select({ inputHash: recommendations.inputHash })
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
  if (next.policyVersion !== POLICY_VERSION) return;
  const result = { ...next, conceptId: next.conceptId ? (snapshot.idOfSlug.get(next.conceptId) ?? null) : null };
  await withTx(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM learners WHERE id = ${learnerId} FOR NO KEY UPDATE`);
    const current = await recommendationInput(tx, learnerId, worldId);
    if (current.inputHash === snapshot.inputHash && !current.current)
      await insertRecommendation(tx, learnerId, worldId, result, snapshot.inputHash);
  });
}

export const POLICY_VERSION = "6";

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

type PendingObservation = {
  id: string;
  source: "attempts" | "lesson_observations";
  kind: AttemptFacts["kind"];
  correct: boolean | null;
  hints_used: number;
  mastery_failures: number;
  question_type: UpdateRequest["questionType"];
  option_count: number | null;
  step_concepts: unknown;
  lesson_concepts: string[];
  world_id: string;
  config: { bkt?: unknown } | null;
};

async function nextObservation(tx: Db, learnerId: string, failed: string[]) {
  const { rows: [row] } = await tx.execute<PendingObservation>(sql`
    WITH pending AS (
      SELECT a.id, 'attempts' AS source, a.kind, a.correct, a.hints_used, a.mastery_failures,
        s.public->>'kind' AS question_type,
        CASE WHEN jsonb_typeof(s.public->'options') = 'array' THEN jsonb_array_length(s.public->'options') END AS option_count,
        s.secret->'concepts' AS step_concepts, s.lesson_version_id, a.created_at
      FROM attempts a JOIN steps s ON s.id = a.step_id
      WHERE a.learner_id = ${learnerId} AND a.observed AND a.mastery_applied_at IS NULL
        AND (a.mastery_retry_at IS NULL OR a.mastery_retry_at <= now())
      UNION ALL
      SELECT o.id, 'lesson_observations', o.kind, o.correct, o.hints_used, o.mastery_failures,
        o.kind, o.option_count, NULL, o.lesson_version_id, o.created_at
      FROM lesson_observations o
      WHERE o.learner_id = ${learnerId} AND o.mastery_applied_at IS NULL
        AND (o.mastery_retry_at IS NULL OR o.mastery_retry_at <= now())
    )
    SELECT p.*, l.concepts AS lesson_concepts, l.world_id, w.config
    FROM pending p
    JOIN lesson_versions v ON v.id = p.lesson_version_id
    JOIN lessons l ON l.id = v.lesson_id
    JOIN worlds w ON w.id = l.world_id
    WHERE p.id <> ALL(ARRAY[${sql.join(failed.map((id) => sql`${id}`), sql`,`)}]::text[])
    ORDER BY p.created_at, p.id LIMIT 1`);
  return row;
}

const lockLearner = (tx: Db, learnerId: string) =>
  tx.execute(sql`SELECT 1 FROM learners WHERE id = ${learnerId} FOR NO KEY UPDATE`);

const pendingRow = (a: PendingObservation) => sql`id = ${a.id} AND mastery_applied_at IS NULL AND mastery_failures = ${a.mastery_failures}`;

async function priorsFor(tx: Db, learnerId: string, conceptIds: string[]) {
  return conceptIds.length ? tx.select({ conceptId: mastery.conceptId, pKnown: mastery.pKnown, nObs: mastery.nObs })
    .from(mastery).where(and(eq(mastery.learnerId, learnerId), inArray(mastery.conceptId, conceptIds))) : [];
}

async function processObservations(learnerId: string, opts: { worldId?: string }): Promise<void> {
  const started = Date.now();
  const touched = new Set<string>();
  const failed: string[] = [];
  for (let count = 0; count < BATCH && Date.now() - started <= CATCH_UP_BUDGET_MS; count++) {
    const snapshot = await withTx(async (tx) => {
      await lockLearner(tx, learnerId);
      const a = await nextObservation(tx, learnerId, failed);
      if (!a) return null;
      const names = conceptNames(a.source === "attempts" ? a.step_concepts : a.lesson_concepts, `observation ${a.id}`);
      const ids = await ensureConcepts(tx, a.world_id, names);
      const conceptIds = [...ids.values()];
      return { a, conceptIds, priors: await priorsFor(tx, learnerId, conceptIds) };
    });
    if (!snapshot) break;
    const { a, conceptIds, priors } = snapshot;
    const obs = observationOf({ observed: true, kind: a.kind, correct: a.correct, hintsUsed: a.hints_used });
    const table = sql.identifier(a.source);
    let updates: Awaited<ReturnType<typeof engineLearner.update>> = [];
    try {
      if (obs && conceptIds.length) {
        const prior = new Map(priors.map((p) => [p.conceptId, p.pKnown]));
        const bkt = mergeBkt(a.config?.bkt, `world ${a.world_id}`);
        updates = await engineLearner.update({
          priors: conceptIds.map((conceptId) => ({ conceptId, pKnown: prior.get(conceptId) ?? null })),
          ...(bkt && { params: bkt }), questionType: a.question_type,
          ...(a.question_type === "mcq" && a.option_count !== null && { options: a.option_count }),
          correct: obs === "correct",
        }, { timeoutMs: ENGINE_CALL_TIMEOUT_MS });
        if (updates.length !== conceptIds.length || new Set(updates.map((u) => u.conceptId)).size !== conceptIds.length ||
            updates.some((u) => !conceptIds.includes(u.conceptId) || !(u.pNext >= 0 && u.pNext <= 1))) {
          throw new Error("Mastery response does not match the observed concepts");
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failed.push(a.id);
      const retryDelay = a.mastery_failures === 0 ? 0 : Math.min(600, 2 ** Math.min(a.mastery_failures, 10));
      await withTx(async (tx) => {
        await lockLearner(tx, learnerId);
        await tx.execute(sql`
          UPDATE ${table}
          SET mastery_failures = mastery_failures + 1, mastery_error = ${message.slice(0, 500)},
            mastery_retry_at = now() + ${retryDelay} * interval '1 second'
          WHERE ${pendingRow(a)}`);
      });
      console.error(`mastery: observation ${a.id} will be retried`, e);
      continue;
    }
    const applied = await withTx(async (tx) => {
      await lockLearner(tx, learnerId);
      const current = await priorsFor(tx, learnerId, conceptIds);
      const versions = new Map(current.map((p) => [p.conceptId, p.nObs]));
      if (current.length !== priors.length || priors.some((p) => versions.get(p.conceptId) !== p.nObs)) return false;
      const { rowCount } = await tx.execute(sql`
        UPDATE ${table} SET mastery_applied_at = now(), mastery_error = NULL, mastery_retry_at = NULL
        WHERE ${pendingRow(a)}`);
      if (!rowCount) return false;
      for (const u of updates) {
        await tx.insert(mastery).values({ learnerId, conceptId: u.conceptId, pKnown: u.pNext, nObs: 1 })
          .onConflictDoUpdate({ target: [mastery.learnerId, mastery.conceptId],
            set: { pKnown: u.pNext, nObs: sql`${mastery.nObs} + 1`, updatedAt: new Date() } });
      }
      return true;
    });
    if (applied && updates.length) touched.add(a.world_id);
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

export async function catchUpMastery(learnerId: string, worldId?: string) {
  try {
    await applyObservations(learnerId, { worldId });
  } catch (e) {
    console.error("mastery update failed; will catch up on read", e);
  }
}
