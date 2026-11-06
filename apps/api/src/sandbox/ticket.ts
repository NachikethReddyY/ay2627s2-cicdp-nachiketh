import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";

export const TICKET_TTL_MS = 30_000;
export const TICKET_MAX_PENDING = 2000;
const WINDOW_MS = 60_000;
const MAX_MINTS = 20;

export class TicketCapacityError extends Error {
  constructor() {
    super("Too many pending shell tickets");
  }
}

// Per-process, like the `open` map in route.ts: a multi-instance deploy would need a shared store.
const pending = new Map<string, { learnerId: string; exp: number }>();

/** Single-use, short-lived credential for the shell WebSocket, which cannot carry the session cookie cross-host. */
export function mintTicket(learnerId: string, now = Date.now()): string {
  if (pending.size >= TICKET_MAX_PENDING) {
    for (const [t, v] of pending) if (v.exp <= now) pending.delete(t);
    if (pending.size >= TICKET_MAX_PENDING) throw new TicketCapacityError();
  }
  const ticket = randomBytes(32).toString("base64url");
  pending.set(ticket, { learnerId, exp: now + TICKET_TTL_MS });
  return ticket;
}

/** Returns the learner id and consumes the ticket; the entry is removed even when it has expired. */
export function redeemTicket(ticket: string, now = Date.now()): string | null {
  const v = pending.get(ticket);
  if (!v) return null;
  pending.delete(ticket);
  return v.exp > now ? v.learnerId : null;
}

export async function sandboxTicketRoute(app: FastifyInstance) {
  const windows = new Map<string, { start: number; n: number }>();
  const allowed = (learner: string) => {
    const now = Date.now();
    const w = windows.get(learner);
    if (!w || now - w.start >= WINDOW_MS) {
      windows.set(learner, { start: now, n: 1 });
      return true;
    }
    w.n += 1;
    return w.n <= MAX_MINTS;
  };
  const err = (code: string, message: string) => ({ error: { code, message } });

  app.post("/sandbox/shell-ticket", async (req, reply) => {
    if (!env.SANDBOX_ENABLED) return reply.status(503).send(err("unavailable", "Sandbox is disabled"));
    const learner = await resolveLearnerId(req.headers);
    if (!learner) return reply.status(401).send(err("unauthorized", "Sign in required"));
    if (!allowed(learner)) return reply.status(429).send(err("rate_limited", "Slow down"));
    try {
      return { ticket: mintTicket(learner), expiresInMs: TICKET_TTL_MS };
    } catch (e) {
      if (e instanceof TicketCapacityError) return reply.status(429).send(err("rate_limited", "Slow down"));
      throw e;
    }
  });
}
