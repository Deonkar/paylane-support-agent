import type { SignalClassifier, SignalVerdict } from "../jev/signals.ts";
import type { ChatModel, ModelReply } from "../llm/types.ts";
import type { PaylaneApi } from "../paylane/types.ts";
import type { Clock } from "../policy/clock.ts";
import type { TraceEvent } from "../shared/events.ts";
import { maskEmails, redactCardNumbers } from "./redact.ts";
import type { Session } from "./session.ts";
import { TOOL_SPECS, runTool } from "./tools.ts";

export interface AgentDeps {
  model: ChatModel;
  api: PaylaneApi;
  clock: Clock;
  signals: SignalClassifier;
  system: string;
  /** Model calls allowed per customer message before the agent hands off instead of looping. */
  maxModelCalls: number;
}

export const FALLBACK_REPLY =
  "Sorry, I'm having trouble on my side. I've passed your conversation to a teammate, who will reply by email.";

type Emit = (e: TraceEvent) => void;

function conversationSoFar(session: Session): { from: "customer" | "agent"; text: string }[] {
  const out: { from: "customer" | "agent"; text: string }[] = [];
  for (const e of session.events) {
    if (e.type === "customer_message") out.push({ from: "customer", text: e.text });
    if (e.type === "agent_message") out.push({ from: "agent", text: e.text });
  }
  return out;
}

async function handOff(
  session: Session,
  deps: AgentDeps,
  reason: "step_limit" | "model_error",
  record: Emit,
  signals: () => Promise<SignalVerdict>,
) {
  record({ type: "fallback", turn: session.turn, reason });
  const lastUser = session.history.findLast((t) => t.role === "user");
  const lastMessage = lastUser?.role === "user" ? lastUser.text : "";
  const summary = `Agent could not finish (${reason}). Last customer message: ${lastMessage}`;
  record(
    await runTool(
      session,
      {
        id: `fallback_${session.turn}`,
        name: "escalate_to_human",
        args: { customer_id: session.verified?.id ?? null, summary },
      },
      { api: deps.api, clock: deps.clock, signals },
    ),
  );
  session.history.push({ role: "assistant", text: FALLBACK_REPLY, toolCalls: [], raw: null });
  return FALLBACK_REPLY;
}

/**
 * Handles one customer message end to end: redact, judge (Jev) in parallel with the model, run tool calls
 * through the gateway, filter the reply. Never throws for a model failure; the customer gets a safe reply
 * and a person gets the chat.
 */
export async function respond(session: Session, customerText: string, deps: AgentDeps, emit?: Emit): Promise<string> {
  const record: Emit = (e) => {
    session.events.push(e);
    emit?.(e);
  };

  session.turn++;
  const inbound = redactCardNumbers(customerText);
  record({ type: "customer_message", turn: session.turn, text: inbound.text, redactions: inbound.count });
  session.history.push({ role: "user", text: inbound.text });

  // Jev starts now and runs alongside the model. Its verdict is recorded before any tool runs.
  const verdictPromise = deps.signals.classify(conversationSoFar(session));
  let verdictRecorded = false;
  const signals = async (): Promise<SignalVerdict> => {
    const verdict = await verdictPromise;
    if (!verdictRecorded) {
      verdictRecorded = true;
      if (!session.handoff && verdict.flagged[0]) session.handoff = verdict.flagged[0];
      record({
        type: "signals",
        turn: session.turn,
        status: verdict.status,
        readings: verdict.readings,
        flagged: verdict.flagged,
      });
    }
    return verdict;
  };
  const gateway = { api: deps.api, clock: deps.clock, signals };

  for (let call = 0; call < deps.maxModelCalls; call++) {
    let reply: ModelReply;
    const started = performance.now();
    try {
      reply = await deps.model.generate({ system: deps.system, tools: TOOL_SPECS, history: session.history });
    } catch (err) {
      console.warn(
        `[agent] model call failed in session ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await signals();
      return handOff(session, deps, "model_error", record, signals);
    }
    record({
      type: "model_call",
      turn: session.turn,
      model: deps.model.name,
      ms: Math.round(performance.now() - started),
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
    });
    await signals();
    if (reply.toolCalls.length === 0 && !reply.text.trim())
      return handOff(session, deps, "model_error", record, signals);
    session.history.push({ role: "assistant", text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });

    if (reply.toolCalls.length === 0) {
      // Outbound filter: anything masked here is the model breaking R2, recorded so the eval sees it.
      const cards = redactCardNumbers(reply.text);
      const emails = maskEmails(cards.text);
      record({
        type: "agent_message",
        turn: session.turn,
        text: emails.text,
        masked: cards.count + emails.count,
      });
      return emails.text;
    }

    const results = [];
    for (const toolCall of reply.toolCalls) {
      const event = await runTool(session, toolCall, gateway);
      record(event);
      results.push({ id: toolCall.id, name: toolCall.name, result: event.result });
    }
    session.history.push({ role: "tool", results });
  }
  return handOff(session, deps, "step_limit", record, signals);
}
