import { sql } from "drizzle-orm";
import { gameBlocks } from "./shared.ts";

export const activityEvents = (learnerId?: string) => {
  const learner = (column: ReturnType<typeof sql>) => learnerId === undefined ? sql`true` : sql`${column} = ${learnerId}`;
  return sql`
    SELECT a.learner_id, a.created_at, 1 AS attempts,
      CASE WHEN l.assessment IS NULL AND a.correct IS TRUE AND a.hints_used = 0 THEN 15 ELSE 0 END AS xp
    FROM attempts a
    JOIN steps s ON s.id = a.step_id
    JOIN lesson_versions v ON v.id = s.lesson_version_id
    JOIN lessons l ON l.id = v.lesson_id
    WHERE ${learner(sql`a.learner_id`)} AND a.observed AND a.kind <> 'skip'
    UNION ALL
    SELECT o.learner_id, o.created_at, 1 AS attempts, 0 AS xp
    FROM lesson_observations o WHERE ${learner(sql`o.learner_id`)}
    UNION ALL
    SELECT gc.learner_id, gc.created_at, 0 AS attempts, 10 AS xp
    FROM game_completions gc WHERE ${learner(sql`gc.learner_id`)}
      AND NOT EXISTS (
        SELECT 1 FROM lesson_versions v CROSS JOIN LATERAL ${gameBlocks(sql`v.content`)} block
        WHERE v.lesson_id = gc.lesson_id AND v.version = gc.part_idx + 1 AND block.id = gc.block_id
          AND block.props->'kind'->>'kind' = 'grid' AND block.props->'kind'->>'mode' = 'watch'
      )
    UNION ALL
    SELECT pc.learner_id, pc.completed_at, 0 AS attempts, 10 AS xp
    FROM part_completions pc JOIN lessons l ON l.id = pc.lesson_id
    WHERE ${learner(sql`pc.learner_id`)} AND l.kind IN ('practice', 'scrim')`;
};
