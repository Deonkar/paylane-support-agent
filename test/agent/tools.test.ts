import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, type Session } from "../../src/agent/session.ts";
import { TOOL_SPECS, runTool, type GatewayDeps } from "../../src/agent/tools.ts";
import type { SignalVerdict } from "../../src/jev/signals.ts";
import { createPaylaneApi } from "../../src/paylane/api.ts";
import { FIXTURES } from "../../src/paylane/fixtures.ts";
import { createStore } from "../../src/paylane/store.ts";
import { fixedClock } from "../../src/policy/clock.ts";

const OFF: SignalVerdict = { status: "off", readings: null, flagged: [] };

let session: Session;
let deps: GatewayDeps;
let n = 0;

function run(name: string, args: unknown) {
  return runTool(session, { id: `c${++n}`, name, args }, deps);
}

async function verifyAs(email: string, last4: string) {
  return run("get_customer", { email, card_last4: last4 });
}

beforeEach(() => {
  session = createSession("s1");
  deps = {
    api: createPaylaneApi(createStore(FIXTURES, fixedClock("2026-10-12"))),
    clock: fixedClock("2026-10-12"),
    signals: () => Promise.resolve(OFF),
  };
});

describe("tool specs", () => {
  it("exposes the four spec tools with strict JSON Schemas", () => {
    expect(TOOL_SPECS.map((t) => t.name)).toEqual([
      "get_customer",
      "get_transaction",
      "issue_refund",
      "escalate_to_human",
    ]);
    for (const t of TOOL_SPECS) {
      expect(t.parameters).toMatchObject({ type: "object", additionalProperties: false });
      expect(t.parameters).not.toHaveProperty("$schema");
    }
  });
});

describe("get_customer", () => {
  it("verifies with matching email and last 4, never returning the digits or the email", async () => {
    const e = await verifyAs("Maya.Chen@example.com", "4417");
    expect(e.outcome).toBe("ok");
    expect(e.result).toEqual({ verified: true, id: "cus_01", name: "Maya Chen", status: "active" });
    expect(JSON.stringify(e.result)).not.toMatch(/4417|example\.com/);
    expect(session.verified?.id).toBe("cus_01");
  });

  it("gives the identical answer for a wrong digit and an unknown email", async () => {
    const wrongDigits = await verifyAs("maya.chen@example.com", "0000");
    const unknown = await verifyAs("ghost@example.com", "4417");
    expect(wrongDigits.result).toEqual({ verified: false, error: "details_not_matched", attempts_left: 2 });
    expect({ ...unknown.result, attempts_left: 2 }).toEqual(wrongDigits.result);
    expect(session.verified).toBeNull();
  });

  it("locks after three failures, even for the right details", async () => {
    for (let i = 0; i < 3; i++) await verifyAs("maya.chen@example.com", "1111");
    const e = await verifyAs("maya.chen@example.com", "4417");
    expect(e.result).toEqual({ verified: false, error: "verification_locked" });
    expect(session.verified).toBeNull();
  });

  it("refuses to switch the chat to a second customer (R3)", async () => {
    await verifyAs("chris.park@example.com", "8812");
    const e = await verifyAs("lee.morgan@example.com", "1934");
    expect(e.outcome).toBe("blocked");
    expect(e.block).toEqual({ reason: "already_verified", rule: "R3" });
    expect(session.verified?.id).toBe("cus_07");
  });
});

describe("get_transaction", () => {
  it("is blocked before verification (R1)", async () => {
    const e = await run("get_transaction", { customer_id: "cus_01", txn_id: "txn_1001" });
    expect(e).toMatchObject({ outcome: "blocked", block: { reason: "not_verified", rule: "R1" } });
  });

  it("is blocked for another customer's id (R3)", async () => {
    await verifyAs("chris.park@example.com", "8812");
    const e = await run("get_transaction", { customer_id: "cus_13", txn_id: "txn_13001" });
    expect(e).toMatchObject({ outcome: "blocked", block: { reason: "wrong_customer", rule: "R3" } });
  });

  it("adds age and the refund check so the model never does date maths", async () => {
    await verifyAs("marcus.hill@example.com", "6623");
    const e = await run("get_transaction", { customer_id: "cus_06", txn_id: "txn_6001" });
    expect(e.result).toEqual({
      txn_id: "txn_6001",
      amount: 180,
      date: "2026-10-07",
      merchant: "Hilton Hotels",
      status: "settled",
      age_days: 5,
      refund_check: { auto_refund_allowed: false, reason: "over_limit", rule: "R4", next_step: "hand_off" },
    });
  });

  it("reports someone else's transaction as not found when asked through your own id", async () => {
    await verifyAs("chris.park@example.com", "8812");
    const e = await run("get_transaction", { customer_id: "cus_07", txn_id: "txn_13001" });
    expect(e.result).toEqual({ error: "not_found" });
  });
});

describe("issue_refund", () => {
  it("refunds an eligible charge once", async () => {
    await verifyAs("maya.chen@example.com", "4417");
    const spy = vi.spyOn(deps.api, "issue_refund");
    const e = await run("issue_refund", { txn_id: "txn_1001", amount: 42.5 });
    expect(e.outcome).toBe("ok");
    expect(e.result).toEqual({ ok: true, refund_id: "rf_0001" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never touches the API when the policy says no", async () => {
    await verifyAs("marcus.hill@example.com", "6623");
    const spy = vi.spyOn(deps.api, "issue_refund");
    const e = await run("issue_refund", { txn_id: "txn_6001", amount: 180 });
    expect(e).toMatchObject({ outcome: "blocked", block: { reason: "over_limit", rule: "R4" } });
    expect(e.result).toEqual({ ok: false, reason: "over_limit", rule: "R4", next_step: "hand_off" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("waits for this turn's Jev verdict and fails closed when it is unavailable", async () => {
    await verifyAs("maya.chen@example.com", "4417");
    deps.signals = () => Promise.resolve({ status: "unavailable", readings: null, flagged: [] });
    const e = await run("issue_refund", { txn_id: "txn_1001", amount: 42.5 });
    expect(e).toMatchObject({
      outcome: "blocked",
      block: { reason: "safety_check_unavailable", rule: "R14" },
    });
  });

  it("is blocked for the whole chat once a handoff reason is set", async () => {
    await verifyAs("alex.kim@example.com", "7720");
    session.handoff = "fraud";
    const e = await run("issue_refund", { txn_id: "txn_11003", amount: 60 });
    expect(e).toMatchObject({ outcome: "blocked", block: { reason: "needs_human", rule: "R9" } });
  });

  it("passes a processor failure through honestly", async () => {
    await verifyAs("elena.petrova@example.com", "7781");
    const e = await run("issue_refund", { txn_id: "txn_4001", amount: 25 });
    expect(e.outcome).toBe("ok");
    expect(e.result).toEqual({ ok: false, reason: "processor_unavailable" });
  });
});

describe("escalate_to_human", () => {
  it("redacts card numbers, caps the summary and reuses one ticket per chat", async () => {
    await verifyAs("jordan.reyes@example.com", "5556");
    const spy = vi.spyOn(deps.api, "escalate_to_human");
    const long = `Card 4000 0566 5566 5556. ${"x".repeat(1500)}`;
    const first = await run("escalate_to_human", { customer_id: "cus_02", summary: long });
    const second = await run("escalate_to_human", { customer_id: "cus_02", summary: "again" });
    expect(first.result).toEqual({ ticket_id: "tk_0001" });
    expect(second.result).toEqual({ ticket_id: "tk_0001" });
    expect(spy).toHaveBeenCalledTimes(1);
    const sent = spy.mock.calls[0]?.[0].summary ?? "";
    expect(sent).toContain("[card ending 5556]");
    expect(sent).not.toContain("4000 0566");
    expect(sent.length).toBeLessThanOrEqual(1000);
  });

  it("accepts a null customer for someone who never verified", async () => {
    const e = await run("escalate_to_human", { customer_id: null, summary: "Legal threat, unverified" });
    expect(e.result).toEqual({ ticket_id: "tk_0001" });
  });
});

describe("arguments", () => {
  it("rejects invalid arguments without crashing", async () => {
    const e = await run("get_customer", { email: "x" });
    expect(e.outcome).toBe("error");
    expect(e.result).toMatchObject({ error: "invalid_arguments" });
  });

  it("rejects an unknown tool", async () => {
    const e = await run("unfreeze_card", {});
    expect(e).toMatchObject({ outcome: "error", result: { error: "unknown_tool" } });
  });
});
