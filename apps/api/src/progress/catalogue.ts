import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { listed } from "./shared.ts";

export const UNLOCK_AT = 0.8;

const names = new Map<string, string>([
  ["js.values-types", "values and types"],
  ["js.variables", "variables"],
  ["js.conditionals", "conditionals"],
  ["js.loops", "loops"],
  ["js.functions", "functions"],
  ["js.return-values", "return values"],
  ["js.arrays", "arrays"],
  ["js.array-reduce", "array reduce"],
]);

export const isCatalogueConcept = (slug: string) => names.has(slug);
export const catalogueName = (slug: string) => names.get(slug);

export const JS_EDGES: [string, string][] = [
  ["js.values-types", "js.variables"],
  ["js.variables", "js.conditionals"],
  ["js.conditionals", "js.loops"],
  ["js.variables", "js.functions"],
  ["js.functions", "js.return-values"],
  ["js.loops", "js.arrays"],
  ["js.arrays", "js.array-reduce"],
  ["js.functions", "js.array-reduce"],
];

export function edgesFor(config: unknown, conceptSlugs: Iterable<string>): [string, string][] {
  if (config && typeof config === "object" && "conceptEdges" in config && Array.isArray(config.conceptEdges)) {
    const declared = new Set(config.conceptEdges.filter(Array.isArray).map((edge) => edge.join(":")));
    return JS_EDGES.filter((edge) => declared.has(edge.join(":")));
  }
  return [...conceptSlugs].some(isCatalogueConcept) ? JS_EDGES : [];
}

export function unmetPrerequisites(
  lessonConcepts: readonly string[],
  courseConcepts: ReadonlySet<string>,
  edges: readonly [string, string][],
  pKnown: ReadonlyMap<string, number>,

) {
  const taught = new Set(lessonConcepts);
  return [...new Set(edges.filter(([pre, target]) =>
    taught.has(target) && courseConcepts.has(pre) && !taught.has(pre) && (pKnown.get(pre) ?? 0) < UNLOCK_AT,
  ).map(([pre]) => pre))];
}


export async function knownCatalogue(learnerId: string) {
  const { rows } = await db.execute<{ slug: string; p_known: number }>(sql`
    SELECT c.slug, m.p_known FROM mastery m JOIN concepts c ON c.id = m.concept_id
    WHERE m.learner_id = ${learnerId} AND c.world_id IS NULL`);
  return new Map(rows.map((r) => [r.slug, r.p_known]));
}

export async function prerequisitesForLesson(learnerId: string, worldId: string, concepts: string[], config: unknown) {
  const taught = concepts.map((c) => c.trim().toLowerCase());
  const edges = edgesFor(config, taught);
  if (!edges.some(([, target]) => taught.includes(target))) return [];
  const [known, { rows }] = await Promise.all([
    knownCatalogue(learnerId),
    db.execute<{ slug: string }>(sql`
      SELECT DISTINCT lower(btrim(tag)) AS slug
      FROM lessons l CROSS JOIN LATERAL unnest(l.concepts) tag
      WHERE l.world_id = ${worldId} AND ${listed}`),
  ]);
  return unmetPrerequisites(taught, new Set(rows.map((row) => row.slug)), edges, known);
}
