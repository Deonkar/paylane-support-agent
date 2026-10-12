import type { RuleId } from "./rulebook.ts";

/** The Paylane refund policy as numbers. Everything that enforces or describes it reads from here. */
export const POLICY = {
  autoRefundLimitCents: 7_500, // "up to $75": $75.00 itself is allowed
  maxRefundAgeDays: 30, // "under 30 days old": a 30-day-old charge is not
  maxVerifyAttempts: 3, // per chat; last 4 digits is a 1-in-10,000 guess
  fraudPriorityCents: 50_000, // fraud over $500 is marked URGENT in the handoff
} as const;

export type HandoffReason = "fraud" | "legal" | "closure" | "override";

export type RefundBlockReason =
  | "not_verified"
  | "not_found"
  | "needs_human"
  | "safety_check_unavailable"
  | "account_frozen"
  | "already_refunded"
  | "not_settled"
  | "partial_refund"
  | "over_limit"
  | "too_old";

export type NextStep = "verify" | "check_id" | "hand_off" | "explain";

export type RefundDecision =
  | { allow: true }
  | { allow: false; reason: RefundBlockReason; rule: RuleId; next: NextStep };

export interface RefundContext {
  verified: boolean;
  customer: { id: string; status: "active" | "frozen" } | null;
  txn: { customerId: string; amountCents: number; date: string; status: "settled" | "pending" | "refunded" } | null;
  requestedCents: number;
  today: string;
  /** Sticky for the chat once Jev flags it. */
  handoff: HandoffReason | null;
  safetyCheck: "ok" | "unavailable" | "off";
}

/** Each block reason cites exactly one rule. `needs_human` cites R9, or R10 for an override attempt. */
export const REASON_RULE: Record<RefundBlockReason, RuleId> = {
  not_verified: "R1",
  not_found: "R3",
  needs_human: "R9",
  safety_check_unavailable: "R14",
  account_frozen: "R8",
  already_refunded: "R6",
  not_settled: "R7",
  partial_refund: "R4",
  over_limit: "R4",
  too_old: "R5",
};

const NEXT: Record<RefundBlockReason, NextStep> = {
  not_verified: "verify",
  not_found: "check_id",
  needs_human: "hand_off",
  safety_check_unavailable: "hand_off",
  account_frozen: "hand_off",
  already_refunded: "explain",
  not_settled: "explain",
  partial_refund: "explain",
  over_limit: "hand_off",
  too_old: "hand_off",
};

function block(reason: RefundBlockReason, rule: RuleId = REASON_RULE[reason]): RefundDecision {
  return { allow: false, reason, rule, next: NEXT[reason] };
}

const DAY_MS = 86_400_000;

/** Whole UTC calendar days between a transaction date and today; a future date counts as 0. */
export function ageInDays(date: string, today: string): number {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
  return Math.max(0, days);
}

/** Pure decision: the first failing check wins, ordered so the customer hears the most useful reason. */
export function decideRefund(c: RefundContext): RefundDecision {
  if (!c.verified || !c.customer) return block("not_verified");
  if (!c.txn || c.txn.customerId !== c.customer.id) return block("not_found");
  if (c.handoff) return block("needs_human", c.handoff === "override" ? "R10" : "R9");
  if (c.safetyCheck === "unavailable") return block("safety_check_unavailable");
  if (c.customer.status === "frozen") return block("account_frozen");
  if (c.txn.status === "refunded") return block("already_refunded");
  if (c.txn.status === "pending") return block("not_settled");
  if (c.requestedCents !== c.txn.amountCents) return block("partial_refund");
  if (c.txn.amountCents > POLICY.autoRefundLimitCents) return block("over_limit");
  if (ageInDays(c.txn.date, c.today) >= POLICY.maxRefundAgeDays) return block("too_old");
  return { allow: true };
}
