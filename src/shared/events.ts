import { z } from "zod";

/**
 * One event schema for everything that happens in a chat. The agent emits these; the server streams them,
 * the eval grades them, and the transcripts and the UI render them.
 */

export const SIGNAL_KEYS = ["fraud_report", "legal_threat", "closure_request", "override_attempt"] as const;
export const TOOL_NAMES = ["get_customer", "get_transaction", "issue_refund", "escalate_to_human"] as const;
export const HANDOFF_REASONS = ["fraud", "legal", "closure", "override"] as const;
const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12", "R13", "R14"] as const;

export type SignalKey = (typeof SIGNAL_KEYS)[number];
export type ToolName = (typeof TOOL_NAMES)[number];

const readings = z.object({
  fraud_report: z.number().min(0).max(1),
  legal_threat: z.number().min(0).max(1),
  closure_request: z.number().min(0).max(1),
  override_attempt: z.number().min(0).max(1),
});

const turn = z.number().int().nonnegative();

export const customerMessageEvent = z.object({
  type: z.literal("customer_message"),
  turn,
  text: z.string(),
  redactions: z.number().int().nonnegative(),
});

export const signalsEvent = z.object({
  type: z.literal("signals"),
  turn,
  status: z.enum(["ok", "unavailable", "off"]),
  readings: readings.nullable(),
  flagged: z.array(z.enum(HANDOFF_REASONS)),
});

export const toolCallEvent = z.object({
  type: z.literal("tool_call"),
  turn,
  callId: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
  outcome: z.enum(["ok", "blocked", "error"]),
  block: z.object({ reason: z.string(), rule: z.enum(RULE_IDS) }).nullable(),
  ms: z.number().nonnegative(),
});

export const modelCallEvent = z.object({
  type: z.literal("model_call"),
  turn,
  model: z.string(),
  ms: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export const agentMessageEvent = z.object({
  type: z.literal("agent_message"),
  turn,
  text: z.string(),
  masked: z.number().int().nonnegative(),
});

export const fallbackEvent = z.object({
  type: z.literal("fallback"),
  turn,
  reason: z.enum(["step_limit", "model_error"]),
});

export const traceEvent = z.discriminatedUnion("type", [
  customerMessageEvent,
  signalsEvent,
  toolCallEvent,
  modelCallEvent,
  agentMessageEvent,
  fallbackEvent,
]);

export type TraceEvent = z.infer<typeof traceEvent>;
export type ToolCallEvent = z.infer<typeof toolCallEvent>;
export type SignalsEvent = z.infer<typeof signalsEvent>;
export type Readings = z.infer<typeof readings>;
