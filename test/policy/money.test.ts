import { describe, expect, it } from "vitest";
import { centsToDollars, formatUsd, parseDollars } from "../../src/policy/money.ts";

describe("parseDollars", () => {
  it.each([
    [42.5, 4250],
    [75, 7500],
    [0.01, 1],
    [0.1 + 0.2, 30],
    [180, 18000],
  ])("parses %s to %s cents", (amount, cents) => {
    expect(parseDollars(amount)).toEqual({ ok: true, cents });
  });

  it.each([
    [0, "not_positive"],
    [-1, "not_positive"],
    [1.005, "fractional_cents"],
    [0.001, "fractional_cents"],
    [Number.NaN, "not_a_number"],
    [Number.POSITIVE_INFINITY, "not_a_number"],
    [1e10, "too_large"],
  ])("rejects %s as %s", (amount, reason) => {
    expect(parseDollars(amount)).toEqual({ ok: false, reason });
  });
});

describe("display", () => {
  it("converts cents back to dollars", () => {
    expect(centsToDollars(4250)).toBe(42.5);
  });

  it.each([
    [7500, "$75.00"],
    [1800000, "$18,000.00"],
    [1, "$0.01"],
  ])("formats %s cents as %s", (cents, text) => {
    expect(formatUsd(cents)).toBe(text);
  });
});
