import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { lessonVersions, stepProgress, steps } from "../db/schema.ts";
import { parseScrim } from "../parts/scrim-schema.ts";
import { malformedScrim, scrimGateStates } from "./scrim.ts";

export async function loadScrimGates(versionId: string, learnerId: string, connection = db) {
  const [version] = await connection.select({ content: lessonVersions.content }).from(lessonVersions).where(eq(lessonVersions.id, versionId));
  const scrim = parseScrim(version?.content);
  if (!scrim) throw malformedScrim();
  const rows = await connection
    .select({ id: steps.id, idx: steps.idx, pub: steps.public, state: stepProgress.state })
    .from(steps)
    .leftJoin(stepProgress, and(eq(stepProgress.stepId, steps.id), eq(stepProgress.learnerId, learnerId)))
    .where(eq(steps.lessonVersionId, versionId))
    .orderBy(asc(steps.idx));
  return { scrim, gates: scrimGateStates(scrim, rows) };
}
