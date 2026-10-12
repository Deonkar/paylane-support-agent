import { beforeEach, describe, expect, it } from "vitest";
import { createPaylaneApi } from "../../src/paylane/api.ts";
import { FIXTURES } from "../../src/paylane/fixtures.ts";
import { createStore } from "../../src/paylane/store.ts";
import type { PaylaneApi } from "../../src/paylane/types.ts";
import { fixedClock } from "../../src/policy/clock.ts";

const clock = fixedClock("2026-10-12");
let api: PaylaneApi;

beforeEach(() => {
  api = createPaylaneApi(createStore(FIXTURES, clock));
});

describe("fixtures", () => {
  it("has 13 synthetic customers on example.com with 4-digit card endings", () => {
    expect(FIXTURES).toHaveLength(13);
    for (const f of FIXTURES) {
      expect(f.customer.email).toMatch(/@example\.com$/);
      expect(f.customer.card_last4).toMatch(/^\d{4}$/);
    }
  });

  it("uses unique customer and transaction ids", () => {
    const txnIds = FIXTURES.flatMap((f) => f.transactions.map((t) => t.id));
    expect(new Set(txnIds).size).toBe(txnIds.length);
    expect(new Set(FIXTURES.map((f) => f.customer.id)).size).toBe(13);
  });
});

describe("get_customer", () => {
  it("finds a customer by email, case- and space-insensitively, always unverified", async () => {
    expect(await api.get_customer({ email: "  Maya.Chen@Example.com " })).toEqual({
      id: "cus_01",
      name: "Maya Chen",
      card_last4: "4417",
      status: "active",
      verified: false,
    });
  });

  it("returns not_found for an unknown email", async () => {
    expect(await api.get_customer({ email: "nobody@example.com" })).toEqual({ error: "not_found" });
  });
});

describe("get_transaction", () => {
  it("returns the transaction in dollars, dated from the clock", async () => {
    expect(await api.get_transaction({ customer_id: "cus_01", txn_id: "txn_1001" })).toEqual({
      amount: 42.5,
      date: "2026-10-03",
      merchant: "Blue Bottle Coffee",
      status: "settled",
    });
  });

  it("hides another customer's transaction as not_found", async () => {
    expect(await api.get_transaction({ customer_id: "cus_07", txn_id: "txn_13001" })).toEqual({
      error: "not_found",
    });
  });
});

describe("issue_refund", () => {
  it("refunds once and marks the transaction refunded", async () => {
    expect(await api.issue_refund({ txn_id: "txn_1001", amount: 42.5 })).toEqual({
      ok: true,
      refund_id: "rf_0001",
    });
    expect(await api.get_transaction({ customer_id: "cus_01", txn_id: "txn_1001" })).toMatchObject({
      status: "refunded",
    });
    expect(await api.issue_refund({ txn_id: "txn_1001", amount: 42.5 })).toEqual({
      ok: false,
      reason: "already_refunded",
    });
  });

  it("pays exactly once when two refunds race", async () => {
    const results = await Promise.all([
      api.issue_refund({ txn_id: "txn_5001", amount: 35 }),
      api.issue_refund({ txn_id: "txn_5001", amount: 35 }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it.each([
    [{ txn_id: "txn_1001", amount: 50 }, "invalid_amount"],
    [{ txn_id: "txn_1001", amount: 0 }, "invalid_amount"],
    [{ txn_id: "txn_1001", amount: 1.005 }, "invalid_amount"],
    [{ txn_id: "txn_9001", amount: 10.99 }, "not_settled"],
    [{ txn_id: "txn_nope", amount: 1 }, "not_found"],
  ])("rejects %o as %s", async (input, reason) => {
    expect(await api.issue_refund(input)).toEqual({ ok: false, reason });
  });

  it("a processor fault fails the refund and leaves the charge settled", async () => {
    expect(await api.issue_refund({ txn_id: "txn_4001", amount: 25 })).toEqual({
      ok: false,
      reason: "processor_unavailable",
    });
    expect(await api.get_transaction({ customer_id: "cus_04", txn_id: "txn_4001" })).toMatchObject({
      status: "settled",
    });
  });
});

describe("escalate_to_human", () => {
  it("creates numbered tickets, with or without a customer", async () => {
    expect(await api.escalate_to_human({ customer_id: "cus_06", summary: "over limit" })).toEqual({
      ticket_id: "tk_0001",
    });
    expect(await api.escalate_to_human({ customer_id: null, summary: "unverified legal threat" })).toEqual({
      ticket_id: "tk_0002",
    });
  });
});

describe("isolation", () => {
  it("two stores never share state", async () => {
    const other = createPaylaneApi(createStore(FIXTURES, clock));
    await api.issue_refund({ txn_id: "txn_1001", amount: 42.5 });
    expect(await other.get_transaction({ customer_id: "cus_01", txn_id: "txn_1001" })).toMatchObject({
      status: "settled",
    });
  });
});
