import { beforeEach, describe, expect, it } from "vitest";
import { type AgentDeps, CARD_NOTICE, FALLBACK_REPLY, respond } from "../../src/agent/loop.ts";
import { createSession, type Session } from "../../src/agent/session.ts";
import type { SignalClassifier, SignalVerdict } from "../../src/jev/signals.ts";
import { calls, says, scriptedModel } from "../../src/llm/scripted.ts";
import { createPaylaneApi } from "../../src/paylane/api.ts";
import { FIXTURES } from "../../src/paylane/fixtures.ts";
import { createStore } from "../../src/paylane/store.ts";
import { fixedClock } from "../../src/policy/clock.ts";
import type { TraceEvent } from "../../src/shared/events.ts";

const clock = fixedClock("2026-10-12");
const OFF: SignalVerdict = { status: "off", readings: null, flagged: [] };
const verifyMarcus = { name: "get_customer", args: { email: "marcus.hill@example.com", card_last4: "6623" } };

let session: Session;

function deps(
  model: AgentDeps["model"],
  signals: SignalClassifier = { classify: () => Promise.resolve(OFF) },
): AgentDeps {
  return {
    model,
    api: createPaylaneApi(createStore(FIXTURES, clock)),
    clock,
    signals,
    system: "SYSTEM",
    maxModelCalls: 6,
  };
}

const types = (events: readonly TraceEvent[]) => events.map((e) => e.type);

beforeEach(() => {
  session = createSession("t");
});

describe("respond", () => {
  it("runs a tool round trip and replays the model's raw content unchanged", async () => {
    const raw = {
      role: "model",
      parts: [{ functionCall: { name: "get_customer" }, thoughtSignature: "sig" }],
    };
    const model = scriptedModel([{ ...calls(verifyMarcus), raw }, says("You're verified, Marcus.")]);
    const reply = await respond(session, "marcus.hill@example.com, 6623", deps(model));
    expect(reply).toBe("You're verified, Marcus.");
    const second = model.requests[1] ?? [];
    expect(second.map((t) => t.role)).toEqual(["user", "assistant", "tool"]);
    expect(second[1]).toMatchObject({ role: "assistant", raw });
    expect(second[2]).toMatchObject({
      role: "tool",
      results: [{ name: "get_customer", result: { verified: true } }],
    });
  });

  it("runs two tool calls from one reply in order and returns both results in one tool turn", async () => {
    const model = scriptedModel([
      calls(verifyMarcus, { name: "get_transaction", args: { customer_id: "cus_06", txn_id: "txn_6001" } }),
      says("Found it."),
    ]);
    await respond(session, "hi", deps(model));
    const toolTurn = model.requests[1]?.[2];
    expect(toolTurn).toMatchObject({ role: "tool" });
    expect(toolTurn?.role === "tool" ? toolTurn.results.map((r) => r.name) : []).toEqual([
      "get_customer",
      "get_transaction",
    ]);
  });

  it("never shows the model a full card number", async () => {
    const model = scriptedModel([says("Please only share the last 4 digits.")]);
    await respond(session, "my card is 4000 0566 5566 5556", deps(model));
    expect(JSON.stringify(model.requests)).not.toContain("5566 5556");
    expect(model.requests[0]?.[0]).toEqual({ role: "user", text: "my card is [card ending 5556]" });
    expect(session.events[0]).toMatchObject({ type: "customer_message", redactions: 1 });
  });

  it("starts Jev before the model answers, and records its verdict before any tool runs", async () => {
    let releaseJev: (v: SignalVerdict) => void = () => undefined;
    const order: string[] = [];
    const signals: SignalClassifier = {
      classify: () => {
        order.push("jev started");
        return new Promise((r) => (releaseJev = r));
      },
    };
    const model = scriptedModel([
      () => {
        order.push("model called");
        setTimeout(() => {
          releaseJev({ status: "ok", readings: null, flagged: [] });
        }, 5);
        return calls(verifyMarcus);
      },
      says("ok"),
    ]);
    await respond(session, "hi", deps(model, signals));
    expect(order).toEqual(["jev started", "model called"]);
    expect(types(session.events).indexOf("signals")).toBeLessThan(types(session.events).indexOf("tool_call"));
  });

  it("makes a Jev flag sticky, so refunds stay blocked later in the chat", async () => {
    const flagged: SignalClassifier = {
      classify: () => Promise.resolve({ status: "ok", readings: null, flagged: ["fraud"] }),
    };
    await respond(session, "someone stole my card", deps(scriptedModel([says("I'll get a person.")]), flagged));
    expect(session.handoff).toBe("fraud");
    const quiet: SignalClassifier = {
      classify: () => Promise.resolve({ status: "ok", readings: null, flagged: [] }),
    };
    const model = scriptedModel([
      calls(verifyMarcus, { name: "issue_refund", args: { txn_id: "txn_6001", amount: 180 } }),
      says("no"),
    ]);
    await respond(session, "refund it", deps(model, quiet));
    expect(session.handoff).toBe("fraud");
    expect(session.events.filter((e) => e.type === "tool_call").at(-1)).toMatchObject({
      type: "tool_call",
      outcome: "blocked",
      block: { reason: "needs_human" },
    });
  });

  it("returns a blocked call's reason to the model", async () => {
    const model = scriptedModel([
      calls(verifyMarcus, { name: "issue_refund", args: { txn_id: "txn_6001", amount: 180 } }),
      says("over the limit"),
    ]);
    await respond(session, "refund", deps(model));
    const toolTurn = model.requests[1]?.[2];
    expect(toolTurn?.role === "tool" ? toolTurn.results[1]?.result : null).toEqual({
      ok: false,
      reason: "over_limit",
      rule: "R4",
      next_step: "hand_off",
    });
  });

  it("hands off with a safe reply when the model loops past the step limit", async () => {
    const model = scriptedModel(Array.from({ length: 6 }, () => calls(verifyMarcus)));
    const reply = await respond(session, "hi", deps(model));
    expect(reply).toBe(FALLBACK_REPLY);
    expect(model.requests).toHaveLength(6);
    expect(session.events).toContainEqual(expect.objectContaining({ type: "fallback", reason: "step_limit" }));
    expect(session.ticketId).toBe("tk_0001");
  });

  it("hands off with a safe reply when the model errors", async () => {
    const reply = await respond(session, "hi", deps(scriptedModel([new Error("503 overloaded")])));
    expect(reply).toBe(FALLBACK_REPLY);
    expect(session.events).toContainEqual(expect.objectContaining({ type: "fallback", reason: "model_error" }));
    expect(session.ticketId).not.toBeNull();
  });

  it("treats an empty final reply as a model error", async () => {
    const reply = await respond(session, "hi", deps(scriptedModel([says("  ")])));
    expect(reply).toBe(FALLBACK_REPLY);
  });

  it("masks an email the model writes, and records it", async () => {
    const reply = await respond(session, "hi", deps(scriptedModel([says("Is marcus.hill@example.com right?")])));
    expect(reply).toBe("Is m•••@example.com right?");
    expect(session.events.at(-1)).toMatchObject({ type: "agent_message", masked: 1 });
  });

  it("emits every event as it is recorded, in trace order", async () => {
    const seen: TraceEvent[] = [];
    await respond(session, "hi", deps(scriptedModel([calls(verifyMarcus), says("ok")])), (e) => seen.push(e));
    expect(seen).toEqual(session.events);
    expect(types(seen)).toEqual([
      "customer_message",
      "model_call",
      "signals",
      "tool_call",
      "model_call",
      "agent_message",
    ]);
  });

  it("counts turns across messages", async () => {
    const d = deps(scriptedModel([says("one"), says("two")]));
    await respond(session, "a", d);
    await respond(session, "b", d);
    expect(session.turn).toBe(2);
    expect(session.history.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("warns the customer, in code, when it removed a card number from their message", async () => {
    const reply = await respond(
      session,
      "card 4000 0566 5566 5556",
      deps(scriptedModel([says("Thanks, what is your email?")])),
    );
    expect(reply).toBe(`${CARD_NOTICE} Thanks, what is your email?`);
    const plain = await respond(createSession("u"), "hello", deps(scriptedModel([says("Hi!")])));
    expect(plain).toBe("Hi!");
  });
});
