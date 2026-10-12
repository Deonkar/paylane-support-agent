import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type RefundContext, ageInDays, decideRefund } from "../../src/policy/refund-policy.ts";

const TODAY = "2026-10-12";

function daysAgo(n: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

function ctx(
  over: Partial<RefundContext> = {},
  txnOver: Partial<NonNullable<RefundContext["txn"]>> = {},
): RefundContext {
  return {
    verified: true,
    customer: { id: "cus_01", status: "active" },
    txn: { customerId: "cus_01", amountCents: 4250, date: daysAgo(9), status: "settled", ...txnOver },
    requestedCents: txnOver.amountCents ?? 4250,
    today: TODAY,
    handoff: null,
    safetyCheck: "ok",
    ...over,
  };
}

describe("decideRefund", () => {
  it("allows an ordinary eligible refund", () => {
    expect(decideRefund(ctx())).toEqual({ allow: true });
  });

  it.each([
    ["not verified", ctx({ verified: false }), "not_verified", "R1", "verify"],
    ["no transaction", ctx({ txn: null }), "not_found", "R3", "check_id"],
    ["someone else's transaction", ctx({}, { customerId: "cus_99" }), "not_found", "R3", "check_id"],
    ["fraud in the chat", ctx({ handoff: "fraud" }), "needs_human", "R9", "hand_off"],
    ["legal threat in the chat", ctx({ handoff: "legal" }), "needs_human", "R9", "hand_off"],
    ["closure in the chat", ctx({ handoff: "closure" }), "needs_human", "R9", "hand_off"],
    ["override attempt in the chat", ctx({ handoff: "override" }), "needs_human", "R10", "hand_off"],
    [
      "safety check failed",
      ctx({ safetyCheck: "unavailable" }),
      "safety_check_unavailable",
      "R14",
      "hand_off",
    ],
    [
      "frozen account",
      ctx({ customer: { id: "cus_01", status: "frozen" } }),
      "account_frozen",
      "R8",
      "hand_off",
    ],
    ["already refunded", ctx({}, { status: "refunded" }), "already_refunded", "R6", "explain"],
    ["pending", ctx({}, { status: "pending" }), "not_settled", "R7", "explain"],
    [
      "$75 of a $180 charge",
      ctx({ requestedCents: 7500 }, { amountCents: 18000 }),
      "partial_refund",
      "R4",
      "explain",
    ],
    [
      "more than the charge",
      ctx({ requestedCents: 9000 }, { amountCents: 4250 }),
      "partial_refund",
      "R4",
      "explain",
    ],
    ["$75.01", ctx({}, { amountCents: 7501 }), "over_limit", "R4", "hand_off"],
    ["exactly 30 days old", ctx({}, { date: daysAgo(30) }), "too_old", "R5", "hand_off"],
  ] as const)("blocks: %s", (_label, input, reason, rule, next) => {
    expect(decideRefund(input)).toEqual({ allow: false, reason, rule, next });
  });

  it("allows exactly $75.00 at 29 days (both limits inclusive the right way)", () => {
    expect(decideRefund(ctx({}, { amountCents: 7500, date: daysAgo(29) }))).toEqual({ allow: true });
  });

  it("a Jev feature that is switched off does not block", () => {
    expect(decideRefund(ctx({ safetyCheck: "off" }))).toEqual({ allow: true });
  });

  it("a fraud flag beats an otherwise eligible $60 refund", () => {
    const decision = decideRefund(ctx({ handoff: "fraud" }, { amountCents: 6000, date: daysAgo(1) }));
    expect(decision).toMatchObject({ allow: false, reason: "needs_human" });
  });

  it("allows any eligible amount up to $75 and age under 30 days", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 7500 }), fc.integer({ min: 0, max: 29 }), (amountCents, age) => {
        expect(decideRefund(ctx({}, { amountCents, date: daysAgo(age) })).allow).toBe(true);
      }),
    );
  });

  it("never allows more than $75", () => {
    fc.assert(
      fc.property(fc.integer({ min: 7501, max: 10_000_000 }), (amountCents) => {
        expect(decideRefund(ctx({}, { amountCents })).allow).toBe(false);
      }),
    );
  });

  it("never allows a charge 30 days old or older", () => {
    fc.assert(
      fc.property(fc.integer({ min: 30, max: 3650 }), (age) => {
        expect(decideRefund(ctx({}, { date: daysAgo(age) })).allow).toBe(false);
      }),
    );
  });
});

describe("ageInDays", () => {
  it.each([
    ["2026-10-12", "2026-10-12", 0],
    ["2026-10-11", "2026-10-12", 1],
    ["2026-09-30", "2026-10-01", 1],
    ["2028-02-28", "2028-03-01", 2],
    ["2026-09-12", "2026-10-12", 30],
    ["2026-10-20", "2026-10-12", 0],
  ])("%s to %s is %s days", (date, today, days) => {
    expect(ageInDays(date, today)).toBe(days);
  });
});
