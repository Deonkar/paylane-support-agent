import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SignalVerdict } from "../jev/signals.ts";
import type { ToolCall, ToolSpec } from "../llm/types.ts";
import type { PaylaneApi } from "../paylane/types.ts";
import type { Clock } from "../policy/clock.ts";
import { centsToDollars, parseDollars } from "../policy/money.ts";
import { POLICY, ageInDays, decideRefund } from "../policy/refund-policy.ts";
import type { RuleId } from "../policy/rulebook.ts";
import type { ToolCallEvent } from "../shared/events.ts";
import { redactCardNumbers } from "./redact.ts";
import type { Session } from "./session.ts";

/**
 * The gateway between the model and the Paylane API. Every rule code can check is checked here, before the
 * API is touched; a blocked call returns its reason to the model and is recorded for the eval.
 */

export interface GatewayDeps {
  api: PaylaneApi;
  clock: Clock;
  /** This turn's Jev verdict. Refunds wait for it. */
  signals: () => Promise<SignalVerdict>;
}

const SUMMARY_CAP = 1_000;
const id = z.string().min(1).max(64);

const ARGS = {
  get_customer: z.strictObject({ email: z.email().max(254), card_last4: z.string().regex(/^\d{4}$/) }),
  get_transaction: z.strictObject({ customer_id: id, txn_id: id }),
  issue_refund: z.strictObject({ txn_id: id, amount: z.number() }),
  escalate_to_human: z.strictObject({ customer_id: id.nullable(), summary: z.string().min(1).max(4_000) }),
} as const;

type GatewayTool = keyof typeof ARGS;

const DESCRIPTIONS: Record<GatewayTool, string> = {
  get_customer:
    "Verify the customer. Pass the email and the last 4 card digits exactly as the customer gave them. Returns verified true with their id, name and account status, or verified false. Required before any other tool.",
  get_transaction:
    "Look up one of the verified customer's transactions by id. Returns amount, date, merchant, status, its age in days and refund_check, which says whether you may refund it yourself.",
  issue_refund:
    "Refund the full amount of one transaction. Only call it when refund_check.auto_refund_allowed is true. Returns ok with a refund_id, or ok false with the reason.",
  escalate_to_human:
    "Hand the conversation to a person. customer_id is the verified customer's id, or null if they never verified. The summary says what the customer wants, what you checked and why it needs a person.",
};

export const TOOL_SPECS: readonly ToolSpec[] = (Object.keys(ARGS) as GatewayTool[]).map((name) => {
  const { $schema: _drop, ...parameters } = z.toJSONSchema(ARGS[name]);
  return { name, description: DESCRIPTIONS[name], parameters };
});

interface Outcome {
  result: Record<string, unknown>;
  outcome: ToolCallEvent["outcome"];
  block: ToolCallEvent["block"];
}

const ok = (result: Record<string, unknown>): Outcome => ({ result, outcome: "ok", block: null });
const blocked = (reason: string, rule: RuleId, result: Record<string, unknown> = { error: reason, rule }): Outcome => ({
  result,
  outcome: "blocked",
  block: { reason, rule },
});
const error = (result: Record<string, unknown>): Outcome => ({ result, outcome: "error", block: null });

function sameDigits(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function getCustomer(s: Session, a: z.infer<typeof ARGS.get_customer>, d: GatewayDeps): Promise<Outcome> {
  const email = a.email.trim().toLowerCase();
  if (s.verified) {
    if (s.verified.email !== email) return blocked("already_verified", "R3");
    const { id: cid, name, status } = s.verified;
    return ok({ verified: true, id: cid, name, status });
  }
  if (s.failedVerifications >= POLICY.maxVerifyAttempts) return ok({ verified: false, error: "verification_locked" });
  const found = await d.api.get_customer({ email });
  // An unknown email and wrong digits get the same answer, so the agent can't reveal which emails exist.
  if ("error" in found || !sameDigits(found.card_last4, a.card_last4)) {
    s.failedVerifications++;
    const left = POLICY.maxVerifyAttempts - s.failedVerifications;
    return ok(
      left > 0
        ? { verified: false, error: "details_not_matched", attempts_left: left }
        : { verified: false, error: "verification_locked" },
    );
  }
  s.verified = { id: found.id, name: found.name, email, status: found.status };
  return ok({ verified: true, id: found.id, name: found.name, status: found.status });
}

async function loadTxn(s: Session, txnId: string, d: GatewayDeps) {
  if (!s.verified) return null;
  const t = await d.api.get_transaction({ customer_id: s.verified.id, txn_id: txnId });
  if ("error" in t) return null;
  const cents = parseDollars(t.amount);
  if (!cents.ok) throw new Error(`Paylane returned an unusable amount for ${txnId}`);
  return { ...t, amountCents: cents.cents, customerId: s.verified.id };
}

function refundContext(
  s: Session,
  txn: Awaited<ReturnType<typeof loadTxn>>,
  requestedCents: number,
  d: GatewayDeps,
  verdict: SignalVerdict,
) {
  return {
    verified: s.verified !== null,
    customer: s.verified ? { id: s.verified.id, status: s.verified.status } : null,
    txn: txn ? { customerId: txn.customerId, amountCents: txn.amountCents, date: txn.date, status: txn.status } : null,
    requestedCents,
    today: d.clock.today(),
    handoff: s.handoff,
    safetyCheck: verdict.status,
  };
}

async function getTransaction(s: Session, a: z.infer<typeof ARGS.get_transaction>, d: GatewayDeps): Promise<Outcome> {
  if (!s.verified) return blocked("not_verified", "R1");
  if (a.customer_id !== s.verified.id) return blocked("wrong_customer", "R3");
  const txn = await loadTxn(s, a.txn_id, d);
  if (!txn) return ok({ error: "not_found" });
  const decision = decideRefund(refundContext(s, txn, txn.amountCents, d, await d.signals()));
  return ok({
    txn_id: a.txn_id,
    amount: txn.amount,
    date: txn.date,
    merchant: txn.merchant,
    status: txn.status,
    age_days: ageInDays(txn.date, d.clock.today()),
    refund_check: decision.allow
      ? { auto_refund_allowed: true }
      : {
          auto_refund_allowed: false,
          reason: decision.reason,
          rule: decision.rule,
          next_step: decision.next,
        },
  });
}

async function issueRefund(s: Session, a: z.infer<typeof ARGS.issue_refund>, d: GatewayDeps): Promise<Outcome> {
  const requested = parseDollars(a.amount);
  if (!requested.ok) return error({ error: "invalid_amount", detail: requested.reason });
  const txn = await loadTxn(s, a.txn_id, d);
  const decision = decideRefund(refundContext(s, txn, requested.cents, d, await d.signals()));
  if (!decision.allow) {
    return blocked(decision.reason, decision.rule, {
      ok: false,
      reason: decision.reason,
      rule: decision.rule,
      next_step: decision.next,
    });
  }
  return ok(await d.api.issue_refund({ txn_id: a.txn_id, amount: centsToDollars(requested.cents) }));
}

async function escalate(s: Session, a: z.infer<typeof ARGS.escalate_to_human>, d: GatewayDeps): Promise<Outcome> {
  const owner = s.verified?.id ?? null;
  if (a.customer_id !== null && a.customer_id !== owner) return blocked("wrong_customer", "R3");
  if (s.ticketId) return ok({ ticket_id: s.ticketId });
  const summary = redactCardNumbers(a.summary.trim()).text.slice(0, SUMMARY_CAP);
  const { ticket_id } = await d.api.escalate_to_human({ customer_id: owner, summary });
  s.ticketId = ticket_id;
  return ok({ ticket_id });
}

function withArgs<S extends z.ZodType>(
  schema: S,
  args: unknown,
  fn: (a: z.infer<S>) => Promise<Outcome>,
): Promise<Outcome> {
  const parsed = schema.safeParse(args);
  if (parsed.success) return fn(parsed.data);
  const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
  return Promise.resolve(error({ error: "invalid_arguments", detail }));
}

function dispatch(s: Session, call: ToolCall, d: GatewayDeps): Promise<Outcome> {
  switch (call.name) {
    case "get_customer":
      return withArgs(ARGS.get_customer, call.args, (a) => getCustomer(s, a, d));
    case "get_transaction":
      return withArgs(ARGS.get_transaction, call.args, (a) => getTransaction(s, a, d));
    case "issue_refund":
      return withArgs(ARGS.issue_refund, call.args, (a) => issueRefund(s, a, d));
    case "escalate_to_human":
      return withArgs(ARGS.escalate_to_human, call.args, (a) => escalate(s, a, d));
    default:
      return Promise.resolve(error({ error: "unknown_tool" }));
  }
}

function recordedArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === "string" ? redactCardNumbers(v).text : v;
  return out;
}

/** Runs one tool call through the gateway and returns the trace event describing what happened. */
export async function runTool(s: Session, call: ToolCall, d: GatewayDeps): Promise<ToolCallEvent> {
  const started = performance.now();
  const o = await dispatch(s, call, d);
  return {
    type: "tool_call",
    turn: s.turn,
    callId: call.id,
    tool: call.name,
    args: recordedArgs(call.args),
    ...o,
    ms: Math.round(performance.now() - started),
  };
}
