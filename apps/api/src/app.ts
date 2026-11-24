import Fastify, { type FastifyError, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { env } from "./env.ts";
import { pool } from "./db/client.ts";
import { idleImages } from "./media/imagegen.ts";
import { idle, stopLessonWrites } from "./ai/service.ts";
import { designFeedbackRoutes } from "./ai/design-feedback.ts";
import { authRoutes } from "./auth/routes.ts";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import { appRouter, type AppRouter } from "./trpc/router.ts";
import { createContext } from "./trpc/trpc.ts";
import { sandboxRoutes } from "./sandbox/route.ts";
import { sandboxRunRoute } from "./sandbox/run.ts";
import { sandboxCheckRoute } from "./sandbox/check.ts";
import { lintRoute } from "./lint/route.ts";
import { sandboxFilesRoute } from "./sandbox/files.ts";
import { redactUrl, sandboxTicketRoute } from "./sandbox/ticket.ts";
import { importRoutes } from "./imports/routes.ts";
import { importsIdle } from "./imports/runner.ts";
import { devRoutes, guideRoutes } from "./dev/route.ts";
import { feedbackRoutes } from "./feedback/routes.ts";
import { studioRoutes } from "./studio/route.ts";

const CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
};

const REQ_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function buildApp(opts: { trustProxy?: string | false } = {}) {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : {
          level: "info",
          serializers: {
            req: (req: FastifyRequest) => ({
              method: req.method,
              url: redactUrl(req.url),
              host: req.host,
              remoteAddress: req.ip,
              remotePort: req.socket?.remotePort,
            }),
          },
        },
    genReqId: (req) => {
      const id = req.headers["x-request-id"];
      return typeof id === "string" && REQ_ID.test(id) ? id : randomUUID();
    },
    trustProxy: opts.trustProxy ?? env.TRUSTED_PROXY ?? false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(helmet);

  const parseJson = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    if (body === "") return done(null, undefined);
    void parseJson(req, body as string, done);
  });

  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD") return;
    const origin = req.headers.origin;
    let devLoopback = false;
    if (env.NODE_ENV === "development" && origin) {
      try {
        const parsed = new URL(origin);
        devLoopback = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
      } catch { }
    }
    if (origin !== undefined && origin !== env.PUBLIC_ORIGIN && !devLoopback) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Bad origin" } });
    }
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    const devLike = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
    const internal = status >= 500 && !devLike;
    reply.status(status).send({
      error: {
        code: CODES[status] ?? (status >= 500 ? "internal" : "bad_request"),
        message: internal ? "Internal error" : err.message,
      },
    });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: "Route not found" } }),
  );

  app.addHook("onClose", async () => {
    stopLessonWrites();
    await idle();
    await importsIdle();
    await idleImages();
    await pool.end().catch(() => undefined);
  });

  app.register(
    async (api) => {
      api.register(authRoutes);
      api.register(fastifyTRPCPlugin, {
        prefix: "/trpc",
        trpcOptions: {
          router: appRouter,
          createContext,
          onError: ({ error, req }) => {
            if (error.code === "INTERNAL_SERVER_ERROR") req.log.error(error);
          },
        } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
      });
      api.register(sandboxRoutes);
      api.register(sandboxRunRoute);
      api.register(sandboxCheckRoute);
      api.register(lintRoute);
      api.register(sandboxFilesRoute);
      api.register(sandboxTicketRoute);
      api.register(importRoutes);
      api.register(devRoutes);
      api.register(guideRoutes);
      api.register(designFeedbackRoutes);
      api.register(feedbackRoutes);
      if (env.STUDIO_ENABLED) api.register(studioRoutes);
      api.get(
        "/healthz",
        { schema: { response: { 200: z.object({ ok: z.literal(true), sha: z.string() }) } } },
        async () => ({ ok: true as const, sha: process.env.GIT_SHA ?? "unknown" }),
      );
      api.get(
        "/readyz",
        {
          schema: {
            response: {
              200: z.object({ ok: z.literal(true) }),
              503: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
            },
          },
        },
        async (_req, reply) => {
          try {
            await pool.query("SELECT 1");
            return { ok: true as const };
          } catch {
            return reply
              .status(503)
              .send({ error: { code: "unavailable", message: "Database unavailable" } });
          }
        },
      );
    },
    { prefix: "/api" },
  );

  return app;
}
