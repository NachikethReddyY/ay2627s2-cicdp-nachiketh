import { buildApp } from "./app.ts";
import { env } from "./env.ts";

const app = buildApp();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
// Lets a deploy be checked from the logs without exposing any S3 value (LQ-46).
app.log.info(`media storage: ${env.S3_BUCKET ? `configured (bucket ${env.S3_BUCKET})` : "off"}`);
