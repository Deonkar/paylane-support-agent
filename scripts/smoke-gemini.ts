// One live round trip against Gemini: `pnpm smoke:gemini`. Needs GEMINI_API_KEY in .env.
import { createGeminiModel } from "../src/llm/gemini.ts";
import { loadConfig } from "../src/config.ts";

const config = loadConfig();
const model = createGeminiModel({ apiKey: config.geminiApiKey, model: config.geminiModel });
const started = performance.now();
const reply = await model.generate({
  system: "Reply in five words.",
  tools: [],
  history: [{ role: "user", text: "Say hello." }],
});
console.log(
  `${config.geminiModel}: "${reply.text}" in ${Math.round(performance.now() - started)} ms, ${reply.inputTokens} in / ${reply.outputTokens} out`,
);
