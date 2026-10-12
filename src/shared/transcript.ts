import { POLICY } from "../policy/refund-policy.ts";
import { formatUsd, formatUsdShort } from "../policy/money.ts";
import type { ToolCallEvent, TraceEvent } from "./events.ts";

export type Tone = "plain" | "allowed" | "blocked" | "handoff" | "error";

export interface TranscriptLine {
  n: number;
  kind: "customer" | "agent" | "note";
  text: string;
  tone: Tone;
  eventIndex: number;
}

const BLOCK_TEXT: Record<string, string> = {
  not_verified: "the customer isn't verified yet",
  not_found: "that isn't this customer's transaction",
  needs_human: "this chat needs a person",
  safety_check_unavailable: "the safety check is unavailable",
  account_frozen: "the account is frozen",
  already_refunded: "it was already refunded",
  not_settled: "the charge is still pending",
  partial_refund: "only the full amount can be refunded",
  over_limit: `over the ${formatUsdShort(POLICY.autoRefundLimitCents)} limit`,
  too_old: `${POLICY.maxRefundAgeDays} days old or more`,
  wrong_customer: "that isn't the verified customer",
  already_verified: "this chat is already verified as another customer",
  verification_locked: "too many failed attempts",
};

const FLAG_TEXT: Record<string, string> = {
  fraud: "fraud report",
  legal: "legal threat",
  closure: "account closure",
  override: "attempt to change the rules",
};

function str(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

function money(v: unknown): string {
  return typeof v === "number" ? formatUsd(Math.round(v * 100)) : str(v);
}

/** The plain-language note for one tool call. The same sentence appears in the UI and in transcripts. */
export function describeToolCall(e: ToolCallEvent): { text: string; tone: Tone } {
  const { args, result } = e;
  if (e.outcome === "error") return { text: "Tool call rejected: the arguments were invalid", tone: "error" };
  if (e.outcome === "blocked" && e.block) {
    const why = BLOCK_TEXT[e.block.reason] ?? e.block.reason;
    const action =
      e.tool === "issue_refund"
        ? "Refund not allowed"
        : e.tool === "get_customer"
          ? "Identity check refused"
          : e.tool === "escalate_to_human"
            ? "Handoff refused"
            : "Lookup not allowed";
    return { text: `${action}: ${why} (${e.block.rule})`, tone: "blocked" };
  }
  switch (e.tool) {
    case "get_customer":
      if (result.verified === true)
        return { text: `Checked identity: verified as ${str(result.name)}`, tone: "allowed" };
      if (result.error === "verification_locked") {
        return { text: "Checked identity: locked after too many failed attempts", tone: "blocked" };
      }
      return { text: "Checked identity: the details didn't match", tone: "blocked" };
    case "get_transaction":
      if (result.error)
        return { text: `Looked up ${str(args.txn_id)}: not found on this account`, tone: "plain" };
      return {
        text: `Looked up ${str(args.txn_id)}: ${money(result.amount)}, ${str(result.merchant)}, ${str(result.status)}, ${str(result.age_days)} days old`,
        tone: "plain",
      };
    case "issue_refund":
      if (result.ok === true) {
        return {
          text: `Refund issued: ${money(args.amount)} on ${str(args.txn_id)} (${str(result.refund_id)})`,
          tone: "allowed",
        };
      }
      return { text: `Refund failed at the processor: ${str(result.reason)}`, tone: "error" };
    case "escalate_to_human":
      return { text: `Handed to a person: ticket ${str(result.ticket_id)}`, tone: "handoff" };
    default:
      return { text: `Called ${e.tool}`, tone: "plain" };
  }
}

/** Numbers every visible line from 1. The UI, the markdown transcripts and the eval's check citations share it. */
export function toTranscriptLines(events: readonly TraceEvent[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const push = (kind: TranscriptLine["kind"], text: string, tone: Tone, eventIndex: number) => {
    lines.push({ n: lines.length + 1, kind, text, tone, eventIndex });
  };
  events.forEach((e, i) => {
    switch (e.type) {
      case "customer_message":
        push("customer", e.text, "plain", i);
        break;
      case "agent_message":
        push("agent", e.text, "plain", i);
        break;
      case "tool_call": {
        const d = describeToolCall(e);
        push("note", d.text, d.tone, i);
        break;
      }
      case "signals":
        if (e.status === "unavailable")
          push("note", "Safety check unavailable: refunds paused for this turn", "error", i);
        else if (e.flagged.length > 0) {
          push(
            "note",
            `Jev flagged: ${e.flagged.map((f) => FLAG_TEXT[f] ?? f).join(", ")}. Refunds stop for this chat`,
            "handoff",
            i,
          );
        }
        break;
      case "fallback":
        push(
          "note",
          e.reason === "step_limit" ? "Agent stopped after too many steps" : "Model unavailable",
          "error",
          i,
        );
        break;
      case "model_call":
        break;
    }
  });
  return lines;
}
