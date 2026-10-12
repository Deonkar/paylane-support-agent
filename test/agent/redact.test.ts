import { describe, expect, it } from "vitest";
import { luhnValid, maskEmails, redactCardNumbers } from "../../src/agent/redact.ts";

describe("redactCardNumbers", () => {
  it.each(["4000 0566 5566 5556", "4000-0566-5566-5556", "4000056655665556"])("redacts %s", (pan) => {
    expect(redactCardNumbers(`my card is ${pan}, thanks`)).toEqual({
      text: "my card is [card ending 5556], thanks",
      count: 1,
    });
  });

  it("redacts two cards in one message", () => {
    const out = redactCardNumbers("4242424242424242 and 4000 0566 5566 5556");
    expect(out).toEqual({ text: "[card ending 4242] and [card ending 5556]", count: 2 });
  });

  it.each([
    "4000 0566 5566 5557", // fails Luhn
    "txn_6001",
    "card ending 6623",
    "call me on +1 415 555 0134",
    "on 2026-10-12",
    "it was $180.00",
  ])("leaves %s alone", (text) => {
    expect(redactCardNumbers(text)).toEqual({ text, count: 0 });
  });

  it("checks Luhn", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
  });
});

describe("maskEmails", () => {
  it("masks the local part", () => {
    expect(maskEmails("verified marcus.hill@example.com ok")).toEqual({
      text: "verified m•••@example.com ok",
      count: 1,
    });
  });

  it("leaves text without emails alone", () => {
    expect(maskEmails("no email here")).toEqual({ text: "no email here", count: 0 });
  });
});
