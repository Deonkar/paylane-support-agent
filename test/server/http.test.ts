import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calls, says, scriptedModel } from "../../src/llm/scripted.ts";
import { fixedClock } from "../../src/policy/clock.ts";
import { createRuntime } from "../../src/runtime.ts";
import { LIMITS, createAppServer } from "../../src/server/http.ts";

const config = { geminiApiKey: "SECRET-GEMINI-KEY", geminiModel: "m", typesafeApiKey: null };
let close: () => void = () => undefined;

async function start(steps = [says("hello")], staticDir?: string) {
  const runtime = createRuntime(config, { model: scriptedModel(steps), clock: fixedClock("2026-10-12") });
  const server = createAppServer(runtime, staticDir ? { staticDir } : {});
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  close = () => server.close();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const session = async () => ((await (await post("/api/sessions", {})).json()) as { sessionId: string }).sessionId;
  return { base, post, session };
}

/** A raw request: fetch rewrites Host and normalises paths, which is exactly what these tests need to control. */
function raw(base: string, path: string, host?: string): Promise<number> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, headers: host ? { host } : {} }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

afterEach(() => {
  close();
});

describe("server", () => {
  it("lists synthetic customers with what a tester needs, and never a key", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/customers`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toHaveLength(13);
    expect(text).toContain("marcus.hill@example.com");
    expect(text).not.toContain("SECRET");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("streams trace events then the reply", async () => {
    const { post, session } = await start([
      calls({ name: "get_customer", args: { email: "maya.chen@example.com", card_last4: "4417" } }),
      says("You're verified."),
    ]);
    const res = await post(`/api/sessions/${await session()}/messages`, { text: "maya.chen@example.com 4417" });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const body = await res.text();
    const events = [...body.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => m[1]);
    expect(events).toEqual(["trace", "trace", "trace", "trace", "trace", "trace", "done"]);
    expect(body).toContain('"reply":"You\'re verified."');
    expect(body).not.toContain("SECRET");
  });

  it("rejects malformed and oversized bodies, and unknown sessions", async () => {
    const { post, session } = await start();
    const id = await session();
    expect((await post(`/api/sessions/${id}/messages`, "{nope")).status).toBe(400);
    expect((await post(`/api/sessions/${id}/messages`, { text: "" })).status).toBe(400);
    expect((await post(`/api/sessions/${id}/messages`, { text: "hi", extra: 1 })).status).toBe(400);
    expect((await post(`/api/sessions/${id}/messages`, { text: "x".repeat(LIMITS.bodyBytes) })).status).toBe(413);
    expect((await post("/api/sessions/nope/messages", { text: "hi" })).status).toBe(404);
  });

  it("rate-limits messages per session", async () => {
    const { post, session } = await start(Array.from({ length: 25 }, () => says("ok")));
    const id = await session();
    const statuses = [];
    for (let i = 0; i < LIMITS.messagesPerMinute + 1; i++)
      statuses.push((await post(`/api/sessions/${id}/messages`, { text: "hi" })).status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((s) => s === 200)).toHaveLength(LIMITS.messagesPerMinute);
  });

  it("refuses a foreign Host header (DNS rebinding)", async () => {
    const { base } = await start();
    expect(await raw(base, "/api/customers", "evil.example")).toBe(403);
    expect(await raw(base, "/api/customers")).toBe(200);
  });

  it("serves the built UI with an index fallback, and refuses path traversal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "web-"));
    writeFileSync(join(dir, "index.html"), "<h1>app</h1>");
    const { base } = await start([says("x")], dir);
    expect(await (await fetch(`${base}/report/06`)).text()).toBe("<h1>app</h1>");
    expect(await raw(base, "/..%2fpackage.json")).toBe(403);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});
