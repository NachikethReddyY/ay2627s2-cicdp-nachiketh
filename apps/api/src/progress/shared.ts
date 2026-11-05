import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { userOfLearner, visibleWorld } from "../access.ts";

export const notFound = (message: string) => new TRPCError({ code: "NOT_FOUND", message });
export const Origin = z.enum(["official", "community", "ai"]);
export const PathCard = z.object({
  slug: z.string(),
  title: z.string(),
  tagline: z.string(),
  origin: Origin,
  courseCount: z.number(),
  learners: z.number(),
});

export const Slug = z.object({ slug: z.string().regex(/^[\w-]{1,64}$/) });

// Per-lesson progress over the lesson's current version; used by /me/home and the course and path reads.
// Predict lessons count steps; learn/watch/practice/game-practice lessons are one part, done via part_completions.
export const lessonTotal = sql`(CASE WHEN l.kind = 'predict'
  THEN (SELECT count(*) FROM steps s WHERE s.lesson_version_id = l.current_version_id)::int ELSE 1 END)`;
export const lessonDone = (me: string) => sql`(CASE WHEN l.kind = 'predict'
  THEN (SELECT count(*) FROM steps s JOIN step_progress sp ON sp.step_id = s.id
    WHERE s.lesson_version_id = l.current_version_id AND sp.learner_id = ${me}
      AND sp.state IN ('revealed', 'skipped'))::int
  ELSE (SELECT count(*) FROM part_completions pc WHERE pc.lesson_id = l.id AND pc.learner_id = ${me})::int END)`;
export const lastActive = (me: string) => sql`GREATEST(
  (SELECT max(sp.updated_at) FROM steps s JOIN step_progress sp ON sp.step_id = s.id
    WHERE s.lesson_version_id = l.current_version_id AND sp.learner_id = ${me}),
  (SELECT pc.completed_at FROM part_completions pc WHERE pc.lesson_id = l.id AND pc.learner_id = ${me}))`;
export const complete = (l: { done: number; total: number }) => l.total > 0 && l.done >= l.total;
// Lessons shown in lists: published, or AI drafts that are written when first played.
export const listed = sql`(l.status = 'published' OR (l.source_kind = 'ai' AND l.status = 'draft'))`;
// A course (alias w) the learner may see: public or their own. Paths can list other people's private courses.
export const visibleCourse = (me: string) => visibleWorld(userOfLearner(me));
export const myUser = userOfLearner;
