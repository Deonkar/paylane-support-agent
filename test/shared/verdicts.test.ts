import { describe, expect, it } from "vitest";
import { rulesVerdict, wordingVerdict } from "../../src/shared/verdicts.ts";

const code = (status: "pass" | "fail" | "review") => ({ kind: "code", status });
const jev = (status: "pass" | "fail" | "review") => ({ kind: "jev", status });

describe("verdicts", () => {
  it("rules pass only when every code check passes, ignoring wording", () => {
    expect(rulesVerdict([code("pass"), code("pass"), jev("fail")])).toBe("pass");
    expect(rulesVerdict([code("pass"), code("fail")])).toBe("fail");
  });

  it("wording is fail over review over pass, ignoring code checks", () => {
    expect(wordingVerdict([jev("pass"), jev("review"), code("fail")])).toBe("review");
    expect(wordingVerdict([jev("review"), jev("fail")])).toBe("fail");
    expect(wordingVerdict([jev("pass"), code("fail")])).toBe("pass");
  });
});
