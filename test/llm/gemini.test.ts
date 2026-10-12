import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { createGeminiModel, toContents } from "../../src/llm/gemini.ts";

const raw = {
  role: "model",
  parts: [
    {
      functionCall: { id: "call_1", name: "get_customer", args: { email: "a@b.co" } },
      thoughtSignature: "sig",
    },
  ],
};

describe("toContents", () => {
  it("maps user text, replays model content verbatim, and sends tool results with matching ids", () => {
    expect(
      toContents([
        { role: "user", text: "hi" },
        { role: "assistant", text: "", toolCalls: [], raw },
        { role: "tool", results: [{ id: "call_1", name: "get_customer", result: { verified: true } }] },
        { role: "assistant", text: "fallback", toolCalls: [], raw: null },
      ]),
    ).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      raw,
      {
        role: "user",
        parts: [{ functionResponse: { id: "call_1", name: "get_customer", response: { verified: true } } }],
      },
      { role: "model", parts: [{ text: "fallback" }] },
    ]);
  });
});

describe("createGeminiModel", () => {
  it("sends system, tools and config, and maps calls, text and usage back", async () => {
    const generate = vi.fn((_p: GenerateContentParameters) =>
      Promise.resolve({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "thinking", thought: true }, { text: "Hi " }, { text: "there" }, ...raw.parts],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
      } as GenerateContentResponse),
    );
    const model = createGeminiModel({ apiKey: "k", model: "gemini-3.8-flash", generate });
    const reply = await model.generate({
      system: "SYS",
      tools: [{ name: "get_customer", description: "d", parameters: { type: "object" } }],
      history: [{ role: "user", text: "hi" }],
    });
    expect(reply.text).toBe("Hi there");
    expect(reply.toolCalls).toEqual([{ id: "call_1", name: "get_customer", args: { email: "a@b.co" } }]);
    expect([reply.inputTokens, reply.outputTokens]).toEqual([100, 25]);
    const p = generate.mock.calls[0]?.[0];
    expect(p?.config).toMatchObject({
      systemInstruction: "SYS",
      automaticFunctionCalling: { disable: true },
      tools: [{ functionDeclarations: [{ name: "get_customer", parametersJsonSchema: { type: "object" } }] }],
    });
  });

  it("copes with an empty candidate", async () => {
    const model = createGeminiModel({
      apiKey: "k",
      model: "m",
      generate: () => Promise.resolve({} as GenerateContentResponse),
    });
    expect(await model.generate({ system: "", tools: [], history: [] })).toMatchObject({
      text: "",
      toolCalls: [],
    });
  });
});
