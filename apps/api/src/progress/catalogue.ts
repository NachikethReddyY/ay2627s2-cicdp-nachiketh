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
  threshold: number,
) {
  const taught = new Set(lessonConcepts);
  return [...new Set(edges.filter(([pre, target]) =>
    taught.has(target) && courseConcepts.has(pre) && !taught.has(pre) && (pKnown.get(pre) ?? 0) < threshold,
  ).map(([pre]) => pre))];
}
