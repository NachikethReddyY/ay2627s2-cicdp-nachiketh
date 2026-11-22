import { and, asc, eq, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { lessonRef, playableLesson, visibleWorld } from "../access.ts";
import { db } from "../db/client.ts";
import { learners, lessons, lessonVersions, steps, worlds } from "../db/schema.ts";
import { practiceOf } from "../parts/practice.ts";
import { guideStep } from "../attempts/router.ts";

export async function loadGuideContext(learnerId: string, lessonId: string) {
  const [found] = await db.select({ lesson: lessons, versionId: lessonVersions.id, content: lessonVersions.content })
    .from(lessons)
    .innerJoin(lessonVersions, eq(lessonVersions.id, lessons.currentVersionId))
    .innerJoin(worlds, eq(worlds.id, lessons.worldId))
    .innerJoin(learners, eq(learners.id, learnerId))
    .where(and(lessonRef(lessonId, lessons), playableLesson(lessons), visibleWorld(learners.userId, worlds)));
  if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
  const practice = practiceOf(found.content);
  const lessonSteps = await db.select({ id: steps.id }).from(steps)
    .where(and(eq(steps.lessonVersionId, found.versionId), gte(steps.idx, 0))).orderBy(asc(steps.idx));
  const hint = await guideStep(learnerId, lessonSteps.map((step) => step.id));
  return {
    context: {
      lessonId: found.lesson.id,
      title: found.lesson.title,
      task: hint?.task ?? practice?.instructions ?? found.lesson.title,
      concepts: found.lesson.concepts,
      hintRung: hint?.rung ?? 0,
    },
    recordHint: hint?.record,
    answers: [practice?.referenceSolution, ...(practice?.tests.filter((test) => test.visibility === "hidden").map((test) => test.expectedStdout) ?? []), ...(hint?.answers ?? [])].filter((answer): answer is string => Boolean(answer)),
  };
}
