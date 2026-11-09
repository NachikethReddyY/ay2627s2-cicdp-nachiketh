import Fastify, { type FastifyError, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { env } from "./env.ts";
import { pool } from "./db/client.ts";
import { idle } from "./ai/service.ts";
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

const CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
};

// A client-sent request id lands in every log line, so only a short plain token is kept (no log forging or huge values).
const REQ_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function buildApp(opts: { trustProxy?: string | false } = {}) {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : {
          level: "info",
          serializers: {
            // Same fields as Fastify's default, but the shell ticket in the query string must never reach the logs.
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

  // Empty JSON bodies become undefined so clients that always send the JSON header can POST without a body.
  // The default parser is kept for everything else: it rejects __proto__/constructor keys.
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    if (body === "") return done(null, undefined);
    parseJson(req, body as string, done);
  });

  // Origin check instead of a CSRF token: SameSite=Lax cookies plus this hook (docs/api-plan.md §1).
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD") return;
    const origin = req.headers.origin;
    let devLoopback = false;
    if (env.NODE_ENV === "development" && origin) {
      try {
        const parsed = new URL(origin);
        devLoopback = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
      } catch { /* Invalid origins fail the exact origin check below. */ }
    }
    if (origin !== undefined && origin !== env.PUBLIC_ORIGIN && !devLoopback) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Bad origin" } });
    }
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    // Reads process.env directly so an unset NODE_ENV counts as production here.
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
    // onClose runs after in-flight requests finish, so no read can start a new prefetch now.
    // Let background prefetches save what they generated before the pool goes away.
    await idle();
    await importsIdle();
    // A test helper may already have ended the pool; pg rejects a second end().
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
