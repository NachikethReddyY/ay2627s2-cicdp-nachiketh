import type { FastifyInstance } from "fastify";
import websocket, { type WebSocket } from "@fastify/websocket";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { redeemTicket } from "./ticket.ts";
import { getBackend, SandboxBusyError } from "./backend.ts";

const dim = (v: unknown, fallback: number) =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 500 ? (v as number) : fallback;

// One shell per learner and tab: a new connection for the same tab takes over from the old one, so a reload never locks the learner out.
const open = new Map<string, WebSocket>();
const TAB = /^[A-Za-z0-9_-]{1,64}$/;
// Terminal input is keystrokes and pastes; the plugin's 100 MiB default would let one frame tie up memory.
const MAX_PAYLOAD = 64 * 1024;
// Close codes the client can show: too many tabs for this learner, or the server is at its shell limit.
export const CLOSE_TOO_MANY_TABS = 4029;
export const CLOSE_SERVER_BUSY = 4503;

export async function sandboxRoutes(app: FastifyInstance) {
  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD } });

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
        // A ticket (direct browser-to-API connection, no cookie) wins; an invalid one never falls back to the cookie.
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
      // Tab ids cannot contain ":", so the key is unambiguous.
      const key = `${learnerId}:${q.tab ?? "default"}`;
      const size = { cols: dim(Number(q.cols), 80), rows: dim(Number(q.rows), 24) };

      const sendJson = (m: object) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(m));
      const finish = (m: object) => {
        sendJson(m);
        socket.close();
      };

      // A reconnect of the same tab replaces its old socket, so it never counts against the caps.
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
          // The Docker backend counts idle containers too, which this socket map can't see.
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
