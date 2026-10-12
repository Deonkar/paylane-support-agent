import { describe, expect, it } from "vitest";
import { POLICY, REASON_RULE } from "../../src/policy/refund-policy.ts";
import { RULES, renderRulebook, ruleTexts } from "../../src/policy/rulebook.ts";

describe("rulebook", () => {
  it("has fourteen rules, R1 to R14, in order", () => {
    expect(RULES.map((r) => r.id)).toEqual(Array.from({ length: 14 }, (_, i) => `R${i + 1}`));
  });

  it("takes its numbers from the policy constants", () => {
    const text = renderRulebook();
    expect(text).toContain("$75");
    expect(text).toContain("30 days");
    expect(text).toContain("$500");
    const changed = ruleTexts({ ...POLICY, autoRefundLimitCents: 5000, maxRefundAgeDays: 14 });
    expect(changed.R4).toContain("$50");
    expect(changed.R5).toContain("14 days");
  });

  it("every block reason cites a rule that exists", () => {
    const ids = new Set(RULES.map((r) => r.id));
    for (const rule of Object.values(REASON_RULE)) expect(ids.has(rule)).toBe(true);
  });

  it("renders one numbered line per rule", () => {
    const lines = renderRulebook().split("\n");
    expect(lines).toHaveLength(14);
    expect(lines[0]).toMatch(/^R1\. /);
  });
});
