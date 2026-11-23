ALTER TABLE "concepts" ALTER COLUMN "world_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_global_slug" ON "concepts" USING btree ("slug") WHERE "concepts"."world_id" IS NULL;--> statement-breakpoint
CREATE TEMP TABLE lq117_concepts ON COMMIT DROP AS
SELECT c.id, CASE lower(trim(c.slug))
  WHEN 'values and types' THEN 'js.values-types'
  WHEN 'variables' THEN 'js.variables'
  WHEN 'conditionals' THEN 'js.conditionals'
  WHEN 'loops' THEN 'js.loops'
  WHEN 'functions' THEN 'js.functions'
  WHEN 'return values' THEN 'js.return-values'
  WHEN 'arrays' THEN 'js.arrays'
  WHEN 'array reduce' THEN 'js.array-reduce'
END AS slug
FROM concepts c JOIN worlds w ON w.id = c.world_id
WHERE w.slug IN ('codequest', 'variables', 'loops', 'scrim-demo')
  AND lower(trim(c.slug)) IN ('values and types', 'variables', 'conditionals', 'loops', 'functions', 'return values', 'arrays', 'array reduce');--> statement-breakpoint
INSERT INTO concepts (id, world_id, slug, name)
SELECT DISTINCT ON (x.slug) 'catalogue:' || x.slug, NULL, x.slug, c.name
FROM lq117_concepts x JOIN concepts c ON c.id = x.id
ORDER BY x.slug, c.id
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO mastery (learner_id, concept_id, p_known, n_obs, updated_at)
SELECT DISTINCT ON (m.learner_id, g.id) m.learner_id, g.id, m.p_known,
  sum(m.n_obs) OVER (PARTITION BY m.learner_id, g.id), m.updated_at
FROM mastery m JOIN lq117_concepts x ON m.concept_id = x.id
JOIN concepts g ON g.slug = x.slug AND g.world_id IS NULL
ORDER BY m.learner_id, g.id, m.updated_at DESC, m.concept_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE TEMP TABLE lq117_alias (old_slug text PRIMARY KEY, new_slug text NOT NULL) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO lq117_alias VALUES ('values and types', 'js.values-types'), ('variables', 'js.variables'), ('conditionals', 'js.conditionals'), ('loops', 'js.loops'), ('functions', 'js.functions'), ('return values', 'js.return-values'), ('arrays', 'js.arrays'), ('array reduce', 'js.array-reduce');--> statement-breakpoint
UPDATE lessons l SET concepts = ARRAY(SELECT COALESCE(a.new_slug, item.value) FROM unnest(l.concepts) WITH ORDINALITY AS item(value, position) LEFT JOIN lq117_alias a ON a.old_slug = lower(trim(item.value)) ORDER BY item.position)
FROM worlds w WHERE l.world_id = w.id AND w.slug IN ('codequest', 'variables', 'loops', 'scrim-demo');--> statement-breakpoint
UPDATE steps s SET secret = jsonb_set(s.secret, '{concepts}', (SELECT jsonb_agg(COALESCE(a.new_slug, item.value) ORDER BY item.position) FROM jsonb_array_elements_text(s.secret->'concepts') WITH ORDINALITY AS item(value, position) LEFT JOIN lq117_alias a ON a.old_slug = lower(trim(item.value))))
FROM lesson_versions v JOIN lessons l ON l.id = v.lesson_id JOIN worlds w ON w.id = l.world_id
WHERE s.lesson_version_id = v.id AND w.slug IN ('codequest', 'variables', 'loops', 'scrim-demo') AND CASE WHEN jsonb_typeof(s.secret->'concepts') = 'array' THEN jsonb_array_length(s.secret->'concepts') > 0 ELSE false END;--> statement-breakpoint
UPDATE lessons l SET concepts = ARRAY(SELECT jsonb_array_elements_text(tags.concepts))
FROM worlds w JOIN (VALUES
  ('codequest', 'lesson-1', '["js.functions", "js.array-reduce"]'::jsonb),
  ('codequest', 'lesson-2', '["js.conditionals"]'::jsonb),
  ('loops', 'loops-1', '["js.loops", "array map", "array-filter"]'::jsonb),
  ('scrim-demo', 'scrim-return-values', '["js.functions", "js.return-values"]'::jsonb),
  ('variables', 'variables-1', '["js.variables", "constants"]'::jsonb)
) AS tags(world_slug, lesson_slug, concepts) ON tags.world_slug = w.slug
WHERE l.world_id = w.id AND l.slug = tags.lesson_slug AND l.source_kind <> 'ai';--> statement-breakpoint
UPDATE steps s SET secret = jsonb_set(s.secret, '{concepts}', tags.concepts)
FROM lesson_versions v JOIN lessons l ON l.id = v.lesson_id JOIN worlds w ON w.id = l.world_id
JOIN (VALUES
  ('codequest', 'lesson-1', 's1', '["js.functions", "js.array-reduce"]'::jsonb),
  ('codequest', 'lesson-1', 's2', '["js.functions"]'::jsonb),
  ('codequest', 'lesson-1', 's3', '["js.functions"]'::jsonb),
  ('codequest', 'lesson-2', 'lesson-2-0', '["js.conditionals"]'::jsonb),
  ('codequest', 'lesson-2', 'lesson-2-1', '["js.conditionals"]'::jsonb),
  ('codequest', 'lesson-2', 'lesson-2-2', '["js.conditionals"]'::jsonb),
  ('loops', 'loops-1', 'loops-1-0', '["array map"]'::jsonb),
  ('loops', 'loops-1', 'loops-1-1', '["array-filter"]'::jsonb),
  ('scrim-demo', 'scrim-return-values', 'scrim-return-values-0', '["js.return-values"]'::jsonb),
  ('variables', 'variables-1', 'variables-1-0', '["js.variables"]'::jsonb),
  ('variables', 'variables-1', 'variables-1-1', '["js.variables"]'::jsonb)
) AS tags(world_slug, lesson_slug, step_id, concepts) ON tags.world_slug = w.slug AND tags.lesson_slug = l.slug
WHERE s.lesson_version_id = v.id AND s.id = tags.step_id AND l.source_kind <> 'ai';--> statement-breakpoint
UPDATE worlds SET config = jsonb_set(config, '{conceptEdges}', '[ ["js.values-types","js.variables"], ["js.variables","js.conditionals"], ["js.conditionals","js.loops"], ["js.variables","js.functions"], ["js.functions","js.return-values"], ["js.loops","js.arrays"], ["js.arrays","js.array-reduce"], ["js.functions","js.array-reduce"] ]'::jsonb)
WHERE slug IN ('codequest', 'variables', 'loops', 'scrim-demo');
