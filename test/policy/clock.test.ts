import { describe, expect, it } from "vitest";
import { fixedClock, systemClock } from "../../src/policy/clock.ts";

describe("clock", () => {
  it("a fixed clock always reports its date", () => {
    const clock = fixedClock("2026-10-12");
    expect(clock.today()).toBe("2026-10-12");
    expect(clock.nowMs()).toBe(Date.parse("2026-10-12T12:00:00Z"));
  });

  it("rejects a malformed date", () => {
    expect(() => fixedClock("12/10/2026")).toThrow(/YYYY-MM-DD/);
  });

  it("the system clock reports a UTC calendar date", () => {
    expect(systemClock.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
