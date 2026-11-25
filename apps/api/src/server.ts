import { startPathBuildWorker } from "./ai/path-build-worker.ts";
import { buildApp } from "./app.ts";
import { env, startupWarnings } from "./env.ts";
import { sweepOrphanedJobs } from "./imports/runner.ts";

const SHUTDOWN_MS = 25_000;

const app = buildApp();
const stopPathBuildWorker = startPathBuildWorker();

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`${signal}: shutting down`);
  setTimeout(() => {
    app.log.error("shutdown timed out, exiting");
    process.exit(1);
  }, SHUTDOWN_MS).unref();
  try {
    await stopPathBuildWorker();
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

const swept = await sweepOrphanedJobs(app.log);
if (swept) app.log.warn(`failed ${swept} orphaned import job(s)`);

await app.listen({ port: env.PORT, host: process.env.HOST ?? "0.0.0.0" });
app.log.info(`media storage: ${env.S3_BUCKET ? `configured (bucket ${env.S3_BUCKET})` : "off"}`);
for (const w of startupWarnings(env)) app.log.warn(`WARNING: ${w}`);
