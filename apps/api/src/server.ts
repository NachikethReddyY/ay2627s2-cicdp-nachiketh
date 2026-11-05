import { buildApp } from "./app.ts";
import { env, startupWarnings } from "./env.ts";
import { idle } from "./ai/service.ts";

const SHUTDOWN_MS = 25_000; // under Render's 30s SIGTERM grace

const app = buildApp();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
// Lets a deploy be checked from the logs without exposing any S3 value (LQ-46).
app.log.info(`media storage: ${env.S3_BUCKET ? `configured (bucket ${env.S3_BUCKET})` : "off"}`);
for (const w of startupWarnings(env)) app.log.warn(`WARNING: ${w}`);

// Stop taking requests, let in-flight ones and background prefetches finish, then exit; a hard timeout bounds a hung drain.
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
    // Background prefetches still need the database, and close() ends the pool (app.ts onClose), so drain them first.
    await idle();
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
