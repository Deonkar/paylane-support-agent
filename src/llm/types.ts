/** The provider-agnostic conversation shape the agent loop speaks. Adapters translate it per model vendor. */

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export type Turn =
  | { role: "user"; text: string }
  /** `raw` is the provider's own content for this turn, replayed unchanged (Gemini needs its thought signatures). */
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; raw: unknown }
  | { role: "tool"; results: { id: string; name: string; result: Record<string, unknown> }[] };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ModelReply {
  text: string;
  toolCalls: ToolCall[];
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatModel {
  readonly name: string;
  generate(req: { system: string; tools: readonly ToolSpec[]; history: readonly Turn[] }): Promise<ModelReply>;
}
