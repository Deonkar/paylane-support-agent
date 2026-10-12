import type { AgentDeps } from "./agent/loop.ts";
import { buildSystemPrompt } from "./agent/prompt.ts";
import { createSession, type Session } from "./agent/session.ts";
import type { Config } from "./config.ts";
import { createJevClient } from "./jev/client.ts";
import { createSignalClassifier } from "./jev/signals.ts";
import { createGeminiModel } from "./llm/gemini.ts";
import type { ChatModel } from "./llm/types.ts";
import { createPaylaneApi } from "./paylane/api.ts";
import { FIXTURES } from "./paylane/fixtures.ts";
import { createStore } from "./paylane/store.ts";
import { type Clock, systemClock } from "./policy/clock.ts";

export const MAX_MODEL_CALLS = 6;

/** Wires the agent once; every chat gets its own session and its own copy of the Paylane data. */
export function createRuntime(config: Config, opts: { clock?: Clock; model?: ChatModel } = {}) {
  const model = opts.model ?? createGeminiModel({ apiKey: config.geminiApiKey, model: config.geminiModel });
  const jev = config.typesafeApiKey ? createJevClient({ apiKey: config.typesafeApiKey }) : null;
  const signals = createSignalClassifier(jev);
  const system = buildSystemPrompt();
  const clock = opts.clock ?? systemClock;
  return {
    model: model.name,
    jev: jev ? "on" : "off",
    newChat(id: string): { session: Session; deps: AgentDeps } {
      const api = createPaylaneApi(createStore(FIXTURES, clock));
      return {
        session: createSession(id),
        deps: { model, api, clock, signals, system, maxModelCalls: MAX_MODEL_CALLS },
      };
    },
  };
}
