import { describe, expect, it } from "vitest";
import { type ToolCallEvent, type TraceEvent, traceEvent } from "../../src/shared/events.ts";
import { describeToolCall, toTranscriptLines } from "../../src/shared/transcript.ts";

function call(over: Partial<ToolCallEvent>): ToolCallEvent {
  return {
    type: "tool_call",
    turn: 1,
    callId: "c1",
    tool: "issue_refund",
    args: { txn_id: "txn_6001", amount: 180 },
    result: {},
    outcome: "ok",
    block: null,
    ms: 1,
    ...over,
  };
}

describe("event schema", () => {
  it("round-trips every event type", () => {
    const events: TraceEvent[] = [
      { type: "customer_message", turn: 1, text: "hi", redactions: 0 },
      { type: "signals", turn: 1, status: "off", readings: null, flagged: [] },
      call({}),
      { type: "model_call", turn: 1, model: "m", ms: 5, inputTokens: 10, outputTokens: 2 },
      { type: "agent_message", turn: 1, text: "hello", masked: 0 },
      { type: "fallback", turn: 1, reason: "step_limit" },
    ];
    for (const e of events) expect(traceEvent.parse(e)).toEqual(e);
  });

  it("rejects an unknown event type", () => {
    expect(traceEvent.safeParse({ type: "nope", turn: 1 }).success).toBe(false);
  });
});

describe("describeToolCall", () => {
  it.each([
    [
      call({ tool: "get_customer", result: { verified: true, name: "Marcus Hill" } }),
      "Checked identity: verified as Marcus Hill",
      "allowed",
    ],
    [
      call({ tool: "get_customer", result: { verified: false, error: "details_not_matched" } }),
      "Checked identity: the details didn't match",
      "blocked",
    ],
    [
      call({ tool: "get_customer", result: { verified: false, error: "verification_locked" } }),
      "Checked identity: locked after too many failed attempts",
      "blocked",
    ],
    [
      call({
        tool: "get_transaction",
        args: { txn_id: "txn_6001" },
        result: { amount: 180, merchant: "Hilton Hotels", status: "settled", age_days: 5 },
      }),
      "Looked up txn_6001: $180.00, Hilton Hotels, settled, 5 days old",
      "plain",
    ],
    [
      call({ result: { ok: true, refund_id: "rf_0001" }, args: { txn_id: "txn_1001", amount: 42.5 } }),
      "Refund issued: $42.50 on txn_1001 (rf_0001)",
      "allowed",
    ],
    [
      call({ outcome: "blocked", block: { reason: "over_limit", rule: "R4" } }),
      "Refund not allowed: over the $75 limit (R4)",
      "blocked",
    ],
    [
      call({ outcome: "blocked", block: { reason: "too_old", rule: "R5" } }),
      "Refund not allowed: 30 days old or more (R5)",
      "blocked",
    ],
    [
      call({ result: { ok: false, reason: "processor_unavailable" } }),
      "Refund failed at the processor: processor_unavailable",
      "error",
    ],
    [
      call({ tool: "escalate_to_human", result: { ticket_id: "tk_0001" } }),
      "Handed to a person: ticket tk_0001",
      "handoff",
    ],
    [
      call({ outcome: "error", result: { error: "invalid_arguments" } }),
      "Tool call rejected: the arguments were invalid",
      "error",
    ],
  ] as const)("%#: %s", (e, text, tone) => {
    expect(describeToolCall(e)).toEqual({ text, tone });
  });
});

describe("toTranscriptLines", () => {
  it("numbers visible lines from 1 and skips model calls", () => {
    const lines = toTranscriptLines([
      { type: "customer_message", turn: 1, text: "refund please", redactions: 0 },
      { type: "signals", turn: 1, status: "ok", readings: null, flagged: [] },
      { type: "model_call", turn: 1, model: "m", ms: 5, inputTokens: 10, outputTokens: 2 },
      call({ tool: "escalate_to_human", result: { ticket_id: "tk_0001" } }),
      { type: "agent_message", turn: 1, text: "done", masked: 0 },
      { type: "signals", turn: 2, status: "ok", readings: null, flagged: ["fraud"] },
    ]);
    expect(lines.map((l) => [l.n, l.kind, l.eventIndex])).toEqual([
      [1, "customer", 0],
      [2, "note", 3],
      [3, "agent", 4],
      [4, "note", 5],
    ]);
    expect(lines[3]?.text).toContain("fraud report");
  });
});
