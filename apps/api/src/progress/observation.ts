import type { Db } from "../db/client.ts";
import { lessonObservations } from "../db/schema.ts";

export async function recordLessonObservation(tx: Db, observation: typeof lessonObservations.$inferInsert) {
  const rows = await tx.insert(lessonObservations).values(observation)
    .onConflictDoNothing().returning({ id: lessonObservations.id });
  return rows.length > 0;
}
