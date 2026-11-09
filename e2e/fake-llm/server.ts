// Stands in for the model provider behind the engine's LLM_API_BASE during e2e runs.
// It replays the recorded `responses` from services/engine/tests/fixtures, in the order given by
// FAKE_LLM_FIXTURES (comma-separated fixture names). Any request with no reply left, or any route other
// than the chat endpoint, gets HTTP 500, so a call nobody recorded fails the run loudly.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 8080);
const fixtureDir = process.env.FAKE_LLM_FIXTURE_DIR ?? fileURLToPath(new URL("../../services/engine/tests/fixtures/", import.meta.url));
const names = (process.env.FAKE_LLM_FIXTURES ?? "").split(",").map((n) => n.trim()).filter(Boolean);

const queue: Record<string, unknown>[] = [];
for (const name of names) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`fake-llm: bad fixture name "${name}"`);
  const fixture = JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8")) as { responses?: Record<string, unknown>[] };
  if (!fixture.responses) throw new Error(`fake-llm: ${name}.json has no responses array`);
  queue.push(...fixture.responses);
}

let served = 0;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function drain(req: IncomingMessage) {
  try {
    for await (const _chunk of req) {
      // The request is not checked: replies are played back in order.
    }
  } catch {
    // The engine aborted the request (for example on a client timeout). Nothing to read, and the server must stay up.
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") return send(res, 200, { ok: true, repliesLeft: queue.length });
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    console.error(`fake-llm: no route for ${req.method} ${req.url}`);
    return send(res, 500, { error: { message: `fake-llm: no recorded reply for ${req.method} ${req.url}` } });
  }
  await drain(req);
  const reply = queue.shift();
  if (!reply) {
    console.error("fake-llm: chat request with no recorded reply left");
    return send(res, 500, { error: { message: "fake-llm: no recorded reply left" } });
  }
  served += 1;
  console.log(`fake-llm: reply ${served}, ${queue.length} left`);
  return send(res, 200, { id: `fake-${served}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: "fake-llm", ...reply });
});

server.listen(port, "0.0.0.0", () => console.log(`fake-llm: listening on ${port} with ${queue.length} replies`));
