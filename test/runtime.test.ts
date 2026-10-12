import { describe, expect, it } from "vitest";
import { respond } from "../src/agent/loop.ts";
import { calls, says, scriptedModel } from "../src/llm/scripted.ts";
import { fixedClock } from "../src/policy/clock.ts";
import { createRuntime } from "../src/runtime.ts";

const config = { geminiApiKey: "g", geminiModel: "m", typesafeApiKey: null };

describe("runtime", () => {
  it("gives each chat its own data, so a refund in one never shows in another", async () => {
    const refund = { name: "issue_refund", args: { txn_id: "txn_1001", amount: 42.5 } };
    const verify = { name: "get_customer", args: { email: "maya.chen@example.com", card_last4: "4417" } };
    const model = scriptedModel([calls(verify, refund), says("done"), calls(verify, refund), says("done")]);
    const runtime = createRuntime(config, { model, clock: fixedClock("2026-10-12") });
    expect(runtime.jev).toBe("off");
    for (const id of ["a", "b"]) {
      const { session, deps } = runtime.newChat(id);
      await respond(session, "refund txn_1001", deps);
      expect(session.events.find((e) => e.type === "tool_call" && e.tool === "issue_refund")).toMatchObject({
        result: { ok: true, refund_id: "rf_0001" },
      });
    }
  });
});
