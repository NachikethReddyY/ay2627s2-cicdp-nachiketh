import type { FastifyInstance } from "fastify";
import websocket, { type WebSocket } from "@fastify/websocket";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { getBackend } from "./backend.ts";

const dim = (v: unknown, fallback: number) =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 500 ? (v as number) : fallback;

// One shell per learner and tab: a new connection for the same tab takes over from the old one, so a reload never locks the learner out.
const open = new Map<string, WebSocket>();
const TAB = /^[A-Za-z0-9_-]{1,64}$/;

export async function sandboxRoutes(app: FastifyInstance) {
  await app.register(websocket);

  app.get(
    "/sandbox/shell",
    {
      // Runs before the upgrade, so a rejection is a plain HTTP error. The global origin hook skips GET.
      onRequest: async (req, reply) => {
        const fail = (status: number, code: string, message: string) =>
          reply.status(status).send({ error: { code, message } });
        if (!env.SANDBOX_ENABLED) return fail(503, "unavailable", "Sandbox is disabled");
        if (req.headers.origin !== env.PUBLIC_ORIGIN) return fail(403, "forbidden", "Bad origin");
        const tab = (req.query as Record<string, unknown>).tab;
        if (tab !== undefined && !(typeof tab === "string" && TAB.test(tab))) return fail(400, "bad_request", "Invalid tab id");
        const learnerId = await resolveLearnerId(req.headers);
        if (!learnerId) return fail(401, "unauthorized", "Sign in required");
        (req as unknown as { learnerId: string }).learnerId = learnerId;
      },
      websocket: true,
    },
    (socket, req) => {
      const learnerId = (req as unknown as { learnerId: string }).learnerId;
      const q = req.query as Record<string, string>;
      // Tab ids cannot contain ":", so the key is unambiguous.
      const key = `${learnerId}:${q.tab ?? "default"}`;
      const size = { cols: dim(Number(q.cols), 80), rows: dim(Number(q.rows), 24) };

      const sendJson = (m: object) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(m));
      const finish = (m: object) => {
        sendJson(m);
        socket.close();
      };

      open.get(key)?.close(4000, "replaced");
      open.set(key, socket);

      const ready = getBackend().then((b) => b.openShell(learnerId, size));
      ready.then(
        (shell) => {
          shell.onData((d) => socket.readyState === socket.OPEN && socket.send(d, { binary: true }));
          shell.onExit((code) => finish({ type: "exit", code }));
        },
        (err) => {
          req.log.error(err);
          finish({ type: "error", message: "Could not start the sandbox" });
        },
      );

      socket.on("message", (data: Buffer, isBinary: boolean) => {
        const buf = data;
        ready.then((shell) => {
          if (isBinary) return shell.write(buf);
          try {
            const m = JSON.parse(buf.toString());
            if (m?.type === "resize") shell.resize(dim(m.cols, size.cols), dim(m.rows, size.rows));
          } catch {
            // Malformed control frames are ignored.
          }
        }, () => {});
      });

      socket.on("close", () => {
        if (open.get(key) === socket) open.delete(key);
        ready.then((shell) => shell.kill(), () => {});
      });
    },
  );
}
