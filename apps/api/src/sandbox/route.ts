import type { FastifyInstance } from "fastify";
import websocket, { type WebSocket } from "@fastify/websocket";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { redeemTicket } from "./ticket.ts";
import { WORKSPACE_NAME, getBackend, SandboxBusyError } from "./backend.ts";

const dim = (v: unknown, fallback: number) =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 500 ? (v as number) : fallback;

const open = new Map<string, WebSocket>();
const TAB = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAYLOAD = 64 * 1024;
export const CLOSE_TOO_MANY_TABS = 4029;
export const CLOSE_SERVER_BUSY = 4503;

export async function sandboxRoutes(app: FastifyInstance) {
  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD } });

  app.get(
    "/sandbox/shell",
    {
      onRequest: async (req, reply) => {
        const fail = (status: number, code: string, message: string) =>
          reply.status(status).send({ error: { code, message } });
        if (!env.SANDBOX_ENABLED) return fail(503, "unavailable", "Sandbox is disabled");
        const origin = req.headers.origin;
        let devLoopback = false;
        if (env.NODE_ENV === "development" && origin) {
          try {
            const parsed = new URL(origin);
            devLoopback = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
          } catch {
          }
        }
        if (origin !== env.PUBLIC_ORIGIN && !devLoopback) return fail(403, "forbidden", "Bad origin");
        const tab = (req.query as Record<string, unknown>).tab;
        if (tab !== undefined && !(typeof tab === "string" && TAB.test(tab))) return fail(400, "bad_request", "Invalid tab id");
        const workspace = (req.query as Record<string, unknown>).workspace;
        if (workspace !== undefined && !(typeof workspace === "string" && WORKSPACE_NAME.test(workspace))) return fail(400, "bad_request", "Invalid workspace");
        const ticket = (req.query as Record<string, unknown>).ticket;
        const learnerId =
          ticket === undefined ? await resolveLearnerId(req.headers) : typeof ticket === "string" ? redeemTicket(ticket) : null;
        if (!learnerId) return fail(401, "unauthorized", "Sign in required");
        (req as unknown as { learnerId: string }).learnerId = learnerId;
      },
      websocket: true,
    },
    (socket, req) => {
      const learnerId = (req as unknown as { learnerId: string }).learnerId;
      const q = req.query as Record<string, string>;
      const key = `${learnerId}:${q.tab ?? "default"}`;
      const size = { cols: dim(Number(q.cols), 80), rows: dim(Number(q.rows), 24), ...(q.workspace && { workspace: q.workspace }) };

      const sendJson = (m: object) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(m));
      const finish = (m: object) => {
        sendJson(m);
        socket.close();
      };

      const replacing = open.has(key);
      let tabs = 0;
      for (const k of open.keys()) if (k !== key && k.startsWith(`${learnerId}:`)) tabs++;
      const reject = (code: number, message: string) => {
        sendJson({ type: "error", message });
        socket.close(code, message);
      };
      if (tabs >= env.SANDBOX_MAX_TABS) return reject(CLOSE_TOO_MANY_TABS, `At most ${env.SANDBOX_MAX_TABS} terminals at once`);
      if (!replacing && open.size >= env.SANDBOX_MAX_SHELLS) return reject(CLOSE_SERVER_BUSY, "The sandbox is busy, try again soon");

      open.get(key)?.close(4000, "replaced");
      open.set(key, socket);

      const ready = getBackend().then((b) => b.openShell(learnerId, size));
      ready.then(
        (shell) => {
          shell.onData((d) => socket.readyState === socket.OPEN && socket.send(d, { binary: true }));
          shell.onExit((code) => finish({ type: "exit", code }));
        },
        (err) => {
          if (err instanceof SandboxBusyError) return reject(CLOSE_SERVER_BUSY, "The sandbox is busy, try again soon");
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
