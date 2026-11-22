import { eq } from "drizzle-orm";
import type { IncomingHttpHeaders } from "node:http";
import { db } from "../db/client.ts";
import { learners } from "../db/schema.ts";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.ts";

export async function resolveLearnerId(headers: IncomingHttpHeaders): Promise<string | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!session) return null;
  const find = () => db.select({ id: learners.id }).from(learners).where(eq(learners.userId, session.user.id));
  let [learner] = await find();
  if (!learner) {
    await db.insert(learners).values({ userId: session.user.id }).onConflictDoNothing({ target: learners.userId });
    [learner] = await find();
  }
  return learner.id;
}
