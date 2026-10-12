import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";

describe("config", () => {
  it("needs a Gemini key and names .env.example", () => {
    expect(() => parseConfig({})).toThrow(/\.env\.example/);
  });

  it("defaults the model and treats a blank Jev key as off", () => {
    expect(parseConfig({ GEMINI_API_KEY: "g", TYPESAFE_API_KEY: " " })).toEqual({
      geminiApiKey: "g",
      geminiModel: "gemini-3.5-flash-lite",
      geminiRpm: 14,
      typesafeApiKey: null,
    });
  });

  it("keeps a Jev key and a chosen model", () => {
    expect(parseConfig({ GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-3.8-flash", TYPESAFE_API_KEY: "t" })).toMatchObject(
      {
        geminiModel: "gemini-3.8-flash",
        typesafeApiKey: "t",
      },
    );
  });

  it("treats blank lines copied from .env.example as defaults, and rejects a bad RPM", () => {
    expect(parseConfig({ GEMINI_API_KEY: "g", GEMINI_MODEL: "", GEMINI_RPM: "" })).toMatchObject({
      geminiModel: "gemini-3.5-flash-lite",
      geminiRpm: 14,
    });
    expect(() => parseConfig({ GEMINI_API_KEY: "g", GEMINI_RPM: "0" })).toThrow();
  });
});
