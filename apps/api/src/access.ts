import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

type WorldCols = { visibility: SQLWrapper; ownerId: SQLWrapper };
type LessonCols = { id: SQLWrapper; slug: SQLWrapper };
const rawWorld: WorldCols = { visibility: sql`w.visibility`, ownerId: sql`w.owner_id` };
const rawLesson: LessonCols = { id: sql`l.id`, slug: sql`l.slug` };

export const visibleWorld = (userId: SQLWrapper, world: WorldCols = rawWorld): SQL =>
  sql`(${world.visibility} = 'public' OR ${world.ownerId} = ${userId})`;

export const lessonRef = (ref: string, lesson: LessonCols = rawLesson): SQL =>
  sql`(${lesson.id} = ${ref} OR ${lesson.slug} = ${ref})`;

export const userOfLearner = (learnerId: string): SQL => sql`(SELECT user_id FROM learners WHERE id = ${learnerId})`;

export const meUser: SQL = sql`me.user_id`;
