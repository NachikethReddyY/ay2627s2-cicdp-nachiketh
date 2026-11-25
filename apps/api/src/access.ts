import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

type WorldCols = { visibility: SQLWrapper; ownerId: SQLWrapper };
type LessonStateCols = { status: SQLWrapper; sourceKind: SQLWrapper; worldId: SQLWrapper };
type LessonCols = { id: SQLWrapper; slug: SQLWrapper };
const rawWorld: WorldCols = { visibility: sql`w.visibility`, ownerId: sql`w.owner_id` };
const rawLesson: LessonCols = { id: sql`l.id`, slug: sql`l.slug` };

const rawLessonState: LessonStateCols = { status: sql`l.status`, sourceKind: sql`l.source_kind`, worldId: sql`l.world_id` };

export const listedLesson = (lesson: LessonStateCols = rawLessonState): SQL =>
  sql`(${lesson.status} = 'published' OR (${lesson.sourceKind} = 'ai' AND ${lesson.status} = 'draft'))`;

export const readyPath = (pathId: SQLWrapper): SQL => sql`NOT EXISTS (
  SELECT 1 FROM path_build_jobs build WHERE build.path_id = ${pathId} AND build.state <> 'ready')`;

export const playableLesson = (lesson: LessonStateCols = rawLessonState): SQL => sql`
  ${listedLesson(lesson)} AND NOT EXISTS (
    SELECT 1 FROM path_courses path_course WHERE path_course.world_id = ${lesson.worldId}
      AND NOT (${readyPath(sql`path_course.path_id`)}))`;

export const visibleWorld = (userId: SQLWrapper, world: WorldCols = rawWorld): SQL =>
  sql`(${world.visibility} = 'public' OR ${world.ownerId} = ${userId})`;

export const lessonRef = (ref: string, lesson: LessonCols = rawLesson): SQL =>
  sql`(${lesson.id} = ${ref} OR ${lesson.slug} = ${ref})`;

export const userOfLearner = (learnerId: string): SQL => sql`(SELECT user_id FROM learners WHERE id = ${learnerId})`;

export const meUser: SQL = sql`me.user_id`;
