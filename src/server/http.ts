import { existsSync, readFileSync, statSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { z } from "zod";
import { respond } from "../agent/loop.ts";
import type { Session } from "../agent/session.ts";
import type { AgentDeps } from "../agent/loop.ts";
import { SCENARIOS } from "../eval/scenarios.ts";
import { FIXTURES } from "../paylane/fixtures.ts";
import type { createRuntime } from "../runtime.ts";

type Runtime = ReturnType<typeof createRuntime>;

export const LIMITS = { bodyBytes: 4_096, messagesPerMinute: 20, sessions: 100 } as const;

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

const newSessionBody = z.strictObject({ customerId: z.string().max(16).optional() });
const messageBody = z.strictObject({ text: z.string().trim().min(1).max(2_000) });

interface Chat {
  session: Session;
  deps: AgentDeps;
  sent: number[];
  busy: boolean;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > LIMITS.bodyBytes) throw new HttpError(413, "body too large");
    chunks.push(b);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

/** Test customers for the Playground: synthetic, with the facts a tester needs to verify as them. */
export function customerList() {
  return FIXTURES.map((f) => ({
    id: f.customer.id,
    name: f.customer.name,
    email: f.customer.email,
    cardLast4: f.customer.card_last4,
    status: f.customer.status,
    transactions: f.transactions.map((t) => ({
      id: t.id,
      amountCents: t.amount_cents,
      merchant: t.merchant,
      daysAgo: t.daysAgo,
      status: t.status,
    })),
    situation: SCENARIOS.find((s) => s.customerId === f.customer.id)?.title ?? "Other account in conversation 07",
  }));
}

function serveStatic(dir: string, path: string, res: ServerResponse) {
  const root = resolve(dir);
  const decoded = decodeURIComponent(path);
  if (decoded.includes("..")) throw new HttpError(403, "forbidden");
  let file = resolve(join(root, normalize(decoded)));
  if (!file.startsWith(root)) throw new HttpError(403, "forbidden");
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  if (!existsSync(file)) throw new HttpError(404, "UI not built: run pnpm build");
  res.writeHead(200, { ...SECURITY_HEADERS, "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

/**
 * The Playground's server. Bound to 127.0.0.1 by the caller; also rejects any Host header that isn't localhost,
 * which stops a malicious web page from reaching it through DNS rebinding. Keys never leave this process.
 */
export function createAppServer(runtime: Runtime, opts: { staticDir?: string; now?: () => number } = {}): Server {
  const chats = new Map<string, Chat>();
  const now = opts.now ?? Date.now;
  let counter = 0;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new HttpError(403, "host not allowed");
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/api/meta") {
      send(res, 200, { model: runtime.model, jev: runtime.jev });
      return;
    }
    if (req.method === "GET" && path === "/api/customers") {
      send(res, 200, customerList());
      return;
    }

    if (req.method === "POST" && path === "/api/sessions") {
      parse(newSessionBody, await readJson(req));
      if (chats.size >= LIMITS.sessions) {
        const oldest = chats.keys().next().value;
        if (oldest) chats.delete(oldest);
      }
      const id = `s${++counter}_${now().toString(36)}`;
      chats.set(id, { ...runtime.newChat(id), sent: [], busy: false });
      send(res, 201, { sessionId: id });
      return;
    }

    const m = /^\/api\/sessions\/([\w]+)\/messages$/.exec(path);
    if (req.method === "POST" && m?.[1]) {
      const chat = chats.get(m[1]);
      if (!chat) throw new HttpError(404, "unknown session");
      const { text } = parse(messageBody, await readJson(req));
      const t = now();
      chat.sent = chat.sent.filter((s) => t - s < 60_000);
      if (chat.sent.length >= LIMITS.messagesPerMinute) throw new HttpError(429, "too many messages, wait a minute");
      if (chat.busy) throw new HttpError(409, "the agent is still answering");
      chat.sent.push(t);
      chat.busy = true;
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      try {
        const reply = await respond(chat.session, text, chat.deps, (e) =>
          res.write(`event: trace\ndata: ${JSON.stringify(e)}\n\n`),
        );
        res.end(`event: done\ndata: ${JSON.stringify({ reply })}\n\n`);
      } finally {
        chat.busy = false;
      }
      return;
    }

    if (req.method === "GET" && !path.startsWith("/api/") && opts.staticDir) {
      serveStatic(opts.staticDir, path, res);
      return;
    }
    throw new HttpError(404, "not found");
  }

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return;
      }
      console.error("[server] unexpected error:", err);
      if (res.headersSent) res.end();
      else send(res, 500, { error: "internal error" });
    });
  });
}
