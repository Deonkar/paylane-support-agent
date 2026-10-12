import {
  type Content,
  FunctionCallingConfigMode,
  type GenerateContentParameters,
  type GenerateContentResponse,
  GoogleGenAI,
  ThinkingLevel,
} from "@google/genai";
import type { ChatModel, ToolCall, Turn } from "./types.ts";

type Generate = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

export function toContents(history: readonly Turn[]): Content[] {
  return history.map((turn): Content => {
    switch (turn.role) {
      case "user":
        return { role: "user", parts: [{ text: turn.text }] };
      case "assistant":
        // Replay Gemini's own content verbatim: it carries the thought signatures tool calls need.
        return (turn.raw as Content | null) ?? { role: "model", parts: [{ text: turn.text }] };
      case "tool":
        return {
          role: "user",
          parts: turn.results.map((r) => ({
            functionResponse: { id: r.id, name: r.name, response: r.result },
          })),
        };
    }
  });
}

/** Gemini via `generateContent`. Pass `generate` to test without a network. */
export function createGeminiModel(opts: {
  apiKey: string;
  model: string;
  thinking?: ThinkingLevel;
  generate?: Generate;
}): ChatModel {
  const generate: Generate =
    opts.generate ??
    ((p) =>
      new GoogleGenAI({
        apiKey: opts.apiKey,
        // ponytail: fixed 30s x 3 attempts; tune per model once eval latencies are known
        httpOptions: { timeout: 30_000, retryOptions: { attempts: 3 } },
      }).models.generateContent(p));
  return {
    name: opts.model,
    async generate({ system, tools, history }) {
      const res = await generate({
        model: opts.model,
        contents: toContents(history),
        config: {
          systemInstruction: system,
          ...(tools.length > 0 && {
            tools: [
              {
                functionDeclarations: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.parameters,
                })),
              },
            ],
          }),
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
          thinkingConfig: { thinkingLevel: opts.thinking ?? ThinkingLevel.LOW },
          automaticFunctionCalling: { disable: true },
        },
      });
      const content = res.candidates?.[0]?.content ?? { role: "model", parts: [] };
      const parts = content.parts ?? [];
      const toolCalls: ToolCall[] = parts.flatMap((p, i) =>
        p.functionCall?.name
          ? [
              {
                id: p.functionCall.id ?? `call_${i}`,
                name: p.functionCall.name,
                args: p.functionCall.args ?? {},
              },
            ]
          : [],
      );
      return {
        text: parts
          .filter((p) => p.text && !p.thought)
          .map((p) => p.text)
          .join(""),
        toolCalls,
        raw: content,
        inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0),
      };
    },
  };
}
