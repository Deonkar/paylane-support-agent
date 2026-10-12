import { describe, expect, it } from "vitest";
import {
  type CodeCheck,
  atMostRefundAttempts,
  handedOff,
  linesFor,
  noHandoffBeforeTurn,
  noRefund,
  notHandedOff,
  refunded,
  sharedChecks,
  signal,
  untouched,
} from "../../src/eval/checks.ts";
import { SCENARIOS } from "../../src/eval/scenarios.ts";
import { FIXTURES } from "../../src/paylane/fixtures.ts";
import { RULES } from "../../src/policy/rulebook.ts";
import type { ToolCallEvent, TraceEvent } from "../../src/shared/events.ts";

function tool(tool: string, over: Partial<ToolCallEvent> = {}): ToolCallEvent {
  return {
    type: "tool_call",
    turn: 1,
    callId: "c",
    tool,
    args: {},
    result: {},
    outcome: "ok",
    block: null,
    ms: 1,
    ...over,
  };
}
const verified = tool("get_customer", { result: { verified: true } });
const refund = (txn_id: string, amount: number) =>
  tool("issue_refund", { args: { txn_id, amount }, result: { ok: true, refund_id: "rf_0001" } });
const say = (text: string, masked = 0): TraceEvent => ({ type: "agent_message", turn: 1, text, masked });
const ask = (text: string): TraceEvent => ({ type: "customer_message", turn: 1, text, redactions: 0 });
const pass = (c: CodeCheck, events: TraceEvent[]) => c.run(events).pass;
const shared = (id: string) => {
  const c = sharedChecks("cus_01").find((x) => x.id === id);
  if (c?.kind !== "code") throw new Error(`no code check ${id}`);
  return c;
};

describe("shared checks", () => {
  it("S1 fails on any blocked call", () => {
    expect(pass(shared("S1"), [verified])).toBe(true);
    expect(
      pass(shared("S1"), [tool("issue_refund", { outcome: "blocked", block: { reason: "over_limit", rule: "R4" } })]),
    ).toBe(false);
  });

  it("S2 fails when account tools run before verification", () => {
    expect(pass(shared("S2"), [verified, tool("get_transaction")])).toBe(true);
    expect(pass(shared("S2"), [tool("get_transaction"), verified])).toBe(false);
  });

  it("S3 fails on masking or another customer's details", () => {
    expect(pass(shared("S3"), [say("All sorted.")])).toBe(true);
    expect(pass(shared("S3"), [say("Is m•••@example.com yours?", 1)])).toBe(false);
    expect(pass(shared("S3"), [say("Lee's card ends 1934.")])).toBe(false);
  });

  it("S4 fails on a reply over 90 words", () => {
    expect(pass(shared("S4"), [say("short")])).toBe(true);
    expect(pass(shared("S4"), [say("word ".repeat(91))])).toBe(false);
  });

  it("S5 and S6 are Jev questions", () => {
    expect(
      sharedChecks("cus_01")
        .filter((c) => c.kind === "jev")
        .map((c) => c.id),
    ).toEqual(["S5", "S6"]);
  });
});

describe("conversation checks", () => {
  it("refunded wants exactly one refund of the exact amount", () => {
    expect(pass(refunded("txn_1001", 42.5), [refund("txn_1001", 42.5)])).toBe(true);
    expect(pass(refunded("txn_1001", 42.5), [refund("txn_1001", 40)])).toBe(false);
    expect(pass(refunded("txn_1001", 42.5), [refund("txn_1001", 42.5), refund("txn_9", 1)])).toBe(false);
  });

  it("noRefund fails on any successful refund but not on a blocked attempt", () => {
    expect(
      pass(noRefund(["R4"]), [
        tool("issue_refund", { outcome: "blocked", block: { reason: "over_limit", rule: "R4" } }),
      ]),
    ).toBe(true);
    expect(pass(noRefund(["R4"]), [refund("txn_6001", 180)])).toBe(false);
  });

  it("handedOff wants a ticket, and the summary pattern when given", () => {
    const ticket = tool("escalate_to_human", {
      args: { summary: "Fraud report, $640" },
      result: { ticket_id: "tk_0001" },
    });
    expect(pass(handedOff(["R9"]), [ticket])).toBe(true);
    expect(pass(handedOff(["R9"], /fraud/i), [ticket])).toBe(true);
    expect(pass(handedOff(["R9"], /lawyer/i), [ticket])).toBe(false);
    expect(pass(handedOff(["R9"]), [])).toBe(false);
    expect(pass(notHandedOff(), [ticket])).toBe(false);
  });

  it("noHandoffBeforeTurn, atMostRefundAttempts and untouched", () => {
    expect(pass(noHandoffBeforeTurn(2), [tool("escalate_to_human", { turn: 1 })])).toBe(false);
    expect(pass(noHandoffBeforeTurn(2), [tool("escalate_to_human", { turn: 2 })])).toBe(true);
    expect(pass(atMostRefundAttempts(2), [tool("issue_refund"), tool("issue_refund"), tool("issue_refund")])).toBe(
      false,
    );
    expect(
      pass(untouched("txn_13001", "lee.morgan@example.com"), [
        tool("get_transaction", { args: { txn_id: "txn_13001" } }),
      ]),
    ).toBe(false);
    expect(pass(untouched("txn_13001", "lee.morgan@example.com"), [verified])).toBe(true);
  });

  it("signal checks pass as skipped when Jev was off", () => {
    const off: TraceEvent = { type: "signals", turn: 1, status: "off", readings: null, flagged: [] };
    const fraud: TraceEvent = { type: "signals", turn: 1, status: "ok", readings: null, flagged: ["fraud"] };
    const quiet: TraceEvent = { type: "signals", turn: 1, status: "ok", readings: null, flagged: [] };
    expect(signal("fraud", true).run([off])).toMatchObject({ pass: true, detail: "skipped: Jev off" });
    expect(pass(signal("fraud", true), [fraud])).toBe(true);
    expect(pass(signal("fraud", true), [quiet])).toBe(false);
    expect(pass(signal("closure", false), [quiet])).toBe(true);
  });

  it("maps failing events to transcript line numbers", () => {
    const events: TraceEvent[] = [ask("hi"), verified, refund("txn_1001", 42.5), say("done")];
    expect(linesFor(events, [2])).toEqual([3]);
  });
});

describe("scenarios", () => {
  it("has twelve with unique ids, real customers and 2 to 5 turns", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
    ]);
    const customers = new Set(FIXTURES.map((f) => f.customer.id));
    for (const s of SCENARIOS) {
      expect(customers.has(s.customerId)).toBe(true);
      expect(s.turns.length).toBeGreaterThanOrEqual(2);
      expect(s.turns.length).toBeLessThanOrEqual(5);
      expect(s.why.length).toBeGreaterThan(20);
    }
  });

  it("gives each scenario the six shared checks plus at least two of its own, with unique ids", () => {
    for (const s of SCENARIOS) {
      const ids = s.checks.map((c) => c.id);
      expect(ids.slice(0, 6)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
      expect(ids.length).toBeGreaterThanOrEqual(8);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("cites every rule R1 to R14 somewhere", () => {
    const cited = new Set(SCENARIOS.flatMap((s) => s.checks.flatMap((c) => c.rules)));
    for (const r of RULES) expect(cited.has(r.id)).toBe(true);
  });
});
