import type { ChatModel, ModelReply, ToolCall, Turn } from "./types.ts";

export type ScriptStep = Partial<ModelReply> | Error | ((history: readonly Turn[]) => Partial<ModelReply>);

/**
 * A model that replies from a script, for tests and for running the UI without a key. It records every
 * request so tests can assert exactly what the model was shown.
 */
export function scriptedModel(steps: ScriptStep[], name = "scripted"): ChatModel & { requests: Turn[][] } {
  const queue = [...steps];
  const requests: Turn[][] = [];
  return {
    name,
    requests,
    generate({ history }) {
      requests.push(structuredClone([...history]));
      const step = queue.shift();
      if (step === undefined) return Promise.reject(new Error("scripted model ran out of steps"));
      if (step instanceof Error) return Promise.reject(step);
      const reply = typeof step === "function" ? step(history) : step;
      return Promise.resolve({
        text: "",
        toolCalls: [],
        raw: null,
        inputTokens: 0,
        outputTokens: 0,
        ...reply,
      });
    },
  };
}

let callCounter = 0;

/** Shorthand for a reply that calls one or more tools. */
export function calls(...toolCalls: Omit<ToolCall, "id">[]): Partial<ModelReply> {
  return { toolCalls: toolCalls.map((c) => ({ ...c, id: `call_${++callCounter}` })) };
}

export function says(text: string): Partial<ModelReply> {
  return { text };
}
