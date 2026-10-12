import type { Turn } from "../llm/types.ts";
import type { HandoffReason } from "../policy/refund-policy.ts";
import type { TraceEvent } from "../shared/events.ts";

export interface VerifiedCustomer {
  id: string;
  name: string;
  /** Kept server-side so replies can be checked for it. Never sent to the model. */
  email: string;
  status: "active" | "frozen";
}

/** Everything one chat knows. One session is bound to at most one verified customer. */
export interface Session {
  id: string;
  verified: VerifiedCustomer | null;
  failedVerifications: number;
  /** Set when Jev flags fraud, legal action, closure or an override attempt; sticky for the chat. */
  handoff: HandoffReason | null;
  ticketId: string | null;
  turn: number;
  history: Turn[];
  events: TraceEvent[];
}

export function createSession(id: string): Session {
  return {
    id,
    verified: null,
    failedVerifications: 0,
    handoff: null,
    ticketId: null,
    turn: 0,
    history: [],
    events: [],
  };
}
