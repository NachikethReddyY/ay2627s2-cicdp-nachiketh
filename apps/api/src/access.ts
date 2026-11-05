import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

// Shared lookups for "what may this learner see". Raw SQL callers use the aliases w (worlds) and l (lessons);
// query-builder callers pass the table (worlds, lessons) so the columns are qualified by table name.
type WorldCols = { visibility: SQLWrapper; ownerId: SQLWrapper };
type LessonCols = { id: SQLWrapper; slug: SQLWrapper };
const rawWorld: WorldCols = { visibility: sql`w.visibility`, ownerId: sql`w.owner_id` };
const rawLesson: LessonCols = { id: sql`l.id`, slug: sql`l.slug` };

/** A course is visible to a user when it is public or they own it. Anything else is indistinguishable from missing. */
export const visibleWorld = (userId: SQLWrapper, world: WorldCols = rawWorld): SQL =>
  sql`(${world.visibility} = 'public' OR ${world.ownerId} = ${userId})`;

/** Lessons are addressed by id or slug. */
export const lessonRef = (ref: string, lesson: LessonCols = rawLesson): SQL =>
  sql`(${lesson.id} = ${ref} OR ${lesson.slug} = ${ref})`;

/** The user id behind a learner id (to compare with owner_id) as a scalar subquery. */
export const userOfLearner = (learnerId: string): SQL => sql`(SELECT user_id FROM learners WHERE id = ${learnerId})`;

/** For queries that already join `learners me`. */
export const meUser: SQL = sql`me.user_id`;
