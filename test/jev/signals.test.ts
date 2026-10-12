import { describe, expect, it, vi } from "vitest";
import { JEV_MODEL, createJevClient } from "../../src/jev/client.ts";
import { SIGNAL_QUESTIONS, createSignalClassifier } from "../../src/jev/signals.ts";

type Readings = Record<keyof typeof SIGNAL_QUESTIONS, number>;

function jevResponse(readings: Partial<Readings>, status = 200): Response {
  const answers = Object.fromEntries(Object.entries(readings).map(([k, v]) => [k, { type: "noul", noul: v }]));
  return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 1, output_tokens: 1 } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const QUIET: Readings = { fraud_report: 0.02, legal_threat: 0.03, closure_request: 0.01, override_attempt: 0.04 };
const CONVO = [{ from: "customer" as const, text: "Someone used my card for $640 I didn't spend." }];

function classifierWith(fetch: typeof globalThis.fetch, timeoutMs?: number) {
  const warn = vi.fn();
  const jev = createJevClient({ apiKey: "test-key", fetch, warn, ...(timeoutMs ? { timeoutMs } : {}) });
  return { classifier: createSignalClassifier(jev), warn };
}

describe("signal classifier", () => {
  it("is off, with no request, when no key is configured", async () => {
    expect(await createSignalClassifier(null).classify(CONVO)).toEqual({ status: "off", readings: null, flagged: [] });
  });

  it("returns the four readings and flags nothing below the threshold", async () => {
    const { classifier } = classifierWith(vi.fn(() => Promise.resolve(jevResponse(QUIET))));
    expect(await classifier.classify(CONVO)).toEqual({ status: "ok", readings: QUIET, flagged: [] });
  });

  it("flags every reading at or above 0.5, in a stable order", async () => {
    const { classifier } = classifierWith(
      vi.fn(() => Promise.resolve(jevResponse({ ...QUIET, fraud_report: 0.93, override_attempt: 0.5 }))),
    );
    expect((await classifier.classify(CONVO)).flagged).toEqual(["fraud", "override"]);
  });

  it("sends the pinned model, an object state and all four questions", async () => {
    const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) => Promise.resolve(jevResponse(QUIET)));
    const { classifier } = classifierWith(fetch);
    await classifier.classify(CONVO);
    const sent = fetch.mock.calls[0]?.[1]?.body;
    const body: unknown = JSON.parse(typeof sent === "string" ? sent : "{}");
    expect(body).toMatchObject({ model: JEV_MODEL, state: { conversation: CONVO } });
    expect(Object.keys((body as { questions: object }).questions).sort()).toEqual(Object.keys(SIGNAL_QUESTIONS).sort());
  });

  it("is unavailable, with a warning, when Jev keeps answering 429", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response('{"error":"rate limited"}', { status: 429, headers: { "retry-after": "0" } })),
    );
    const { classifier, warn } = classifierWith(fetch);
    expect(await classifier.classify(CONVO)).toEqual({ status: "unavailable", readings: null, flagged: [] });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("is unavailable when an answer is malformed", async () => {
    const { classifier } = classifierWith(vi.fn(() => Promise.resolve(jevResponse({ ...QUIET, fraud_report: 7 }))));
    expect((await classifier.classify(CONVO)).status).toBe("unavailable");
  });

  it("is unavailable when an answer is missing", async () => {
    const { fraud_report: _drop, ...partial } = QUIET;
    const { classifier } = classifierWith(vi.fn(() => Promise.resolve(jevResponse(partial))));
    expect((await classifier.classify(CONVO)).status).toBe("unavailable");
  });

  it("is unavailable when Jev is unreachable", async () => {
    const { classifier } = classifierWith(vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    expect((await classifier.classify(CONVO)).status).toBe("unavailable");
  });
});

describe("jev client", () => {
  it("returns score values for score questions", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ model: "jev-1.13.0", answers: { tone: { type: "score", score: 1.7, legend: {}, probabilities: {}, confidence: 0.8 } }, usage: { input_tokens: 1, output_tokens: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const jev = createJevClient({ apiKey: "k", fetch, warn: vi.fn() });
    expect(await jev.ask("hi", { tone: { type: "score", instructions: "How warm?", criteria: ["cold", "ok", "warm"] } })).toEqual({ tone: 1.7 });
  });
});
