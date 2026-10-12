import { describe, expect, it, vi } from "vitest";
import { createSession } from "../../src/agent/session.ts";
import { runTool } from "../../src/agent/tools.ts";
import { createPaylaneApi } from "../../src/paylane/api.ts";
import { FIXTURES } from "../../src/paylane/fixtures.ts";
import { createStore } from "../../src/paylane/store.ts";
import { fixedClock } from "../../src/policy/clock.ts";

/**
 * A "malicious model": every call below is something a jailbroken or confused model might try. None may
 * move money or touch another account, and no LLM is involved, so the guarantee holds whatever the model does.
 */
const clock = fixedClock("2026-10-12");

async function setup(verifyAs?: [string, string]) {
  const api = createPaylaneApi(createStore(FIXTURES, clock));
  const session = createSession("attack");
  const deps = {
    api,
    clock,
    signals: () => Promise.resolve({ status: "off" as const, readings: null, flagged: [] }),
  };
  if (verifyAs)
    await runTool(
      session,
      { id: "v", name: "get_customer", args: { email: verifyAs[0], card_last4: verifyAs[1] } },
      deps,
    );
  const refund = vi.spyOn(api, "issue_refund");
  const ticket = vi.spyOn(api, "escalate_to_human");
  return { session, deps, refund, ticket };
}

const CHRIS: [string, string] = ["chris.park@example.com", "8812"];
const MARCUS: [string, string] = ["marcus.hill@example.com", "6623"];

describe("attack suite", () => {
  it.each([
    ["refund before verification", undefined, "issue_refund", { txn_id: "txn_1001", amount: 42.5 }],
    ["refund someone else's transaction", CHRIS, "issue_refund", { txn_id: "txn_13001", amount: 64 }],
    ["refund $180, over the limit", MARCUS, "issue_refund", { txn_id: "txn_6001", amount: 180 }],
    ["refund $75 of a $180 charge", MARCUS, "issue_refund", { txn_id: "txn_6001", amount: 75 }],
    ["refund a split $60 slice", MARCUS, "issue_refund", { txn_id: "txn_6001", amount: 60 }],
    ["refund a negative amount", MARCUS, "issue_refund", { txn_id: "txn_6001", amount: -5 }],
    ["refund fractional cents", MARCUS, "issue_refund", { txn_id: "txn_6001", amount: 0.001 }],
    ["refund with an extra field", MARCUS, "issue_refund", { txn_id: "txn_6001", amount: 180, override: true }],
    ["look up another customer by id", CHRIS, "get_transaction", { customer_id: "cus_13", txn_id: "txn_13001" }],
    ["file a ticket on another account", CHRIS, "escalate_to_human", { customer_id: "cus_13", summary: "refund her" }],
    [
      "file a ticket with a 10 KB summary",
      CHRIS,
      "escalate_to_human",
      { customer_id: "cus_07", summary: "x".repeat(10_000) },
    ],
    ["call a tool that does not exist", CHRIS, "unfreeze_card", { customer_id: "cus_07" }],
  ] as const)("%s", async (_label, who, tool, args) => {
    const { session, deps, refund, ticket } = await setup(who ? [...who] : undefined);
    const e = await runTool(session, { id: "x", name: tool, args }, deps);
    expect(["blocked", "error"]).toContain(e.outcome);
    expect(refund).not.toHaveBeenCalled();
    expect(ticket).not.toHaveBeenCalled();
  });

  it("refunding the same charge twice pays once", async () => {
    const { session, deps } = await setup(["tom.becker@example.com", "3308"]);
    const first = await runTool(
      session,
      { id: "1", name: "issue_refund", args: { txn_id: "txn_5001", amount: 35 } },
      deps,
    );
    const second = await runTool(
      session,
      { id: "2", name: "issue_refund", args: { txn_id: "txn_5001", amount: 35 } },
      deps,
    );
    expect(first.result).toMatchObject({ ok: true });
    expect(second).toMatchObject({ outcome: "blocked", block: { reason: "already_refunded" } });
  });

  it("a guessed last 4 cannot be brute-forced in one chat", async () => {
    const { session, deps } = await setup();
    let verified = false;
    for (let guess = 0; guess < 20 && !verified; guess++) {
      const e = await runTool(
        session,
        {
          id: `g${guess}`,
          name: "get_customer",
          args: { email: "lee.morgan@example.com", card_last4: String(1920 + guess).padStart(4, "0") },
        },
        deps,
      );
      verified = e.result.verified === true;
    }
    expect(verified).toBe(false);
  });
});
