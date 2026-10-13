import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bandStatus, gradeRun, summarize, type GradedRun } from "../../src/eval/grade.ts";
import { buildReport, reportMarkdown, transcriptMarkdown } from "../../src/eval/report.ts";
import { runAll } from "../../src/eval/run.ts";
import { SCENARIOS } from "../../src/eval/scenarios.ts";
import type { JevClient } from "../../src/jev/client.ts";
import { calls, says, scriptedModel } from "../../src/llm/scripted.ts";
import { fixedClock } from "../../src/policy/clock.ts";
import { createRuntime } from "../../src/runtime.ts";

const scenario01 = SCENARIOS[0];
if (!scenario01) throw new Error("missing scenario 01");

/** A model that plays conversation 01 correctly. */
function goodModel() {
  return scriptedModel([
    says("Happy to help. What's the email on your account and the last 4 digits of your card?"),
    calls(
      { name: "get_customer", args: { email: "maya.chen@example.com", card_last4: "4417" } },
      { name: "get_transaction", args: { customer_id: "cus_01", txn_id: "txn_1001" } },
    ),
    calls({ name: "issue_refund", args: { txn_id: "txn_1001", amount: 42.5 } }),
    says("Done: I've refunded $42.50 for Blue Bottle Coffee. Your refund id is rf_0001."),
  ]);
}

const jevSays = (p: number): JevClient => ({
  nouls: (_s, q) => Promise.resolve(Object.fromEntries(Object.keys(q).map((k) => [k, p])) as never),
  ask: () => Promise.resolve(null),
});

const config = { geminiApiKey: "g", geminiModel: "m", geminiRpm: 14, typesafeApiKey: null };

describe("bandStatus", () => {
  it.each([
    [0.05, "no", "pass"],
    [0.95, "no", "fail"],
    [0.95, "yes", "pass"],
    [0.05, "yes", "fail"],
    [0.5, "yes", "review"],
    [0.2, "no", "pass"],
  ] as const)("p=%s passWhen=%s is %s", (p, when, status) => {
    expect(bandStatus(p, when)).toBe(status);
  });
});

describe("runAll and gradeRun", () => {
  it("runs, saves, resumes, and grades a correct conversation as passing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runs-"));
    const runtime = createRuntime(config, { model: goodModel(), clock: fixedClock("2026-10-12") });
    const [record] = await runAll([scenario01], runtime, 1, dir, () => undefined);
    expect(readdirSync(dir)).toEqual(["01.1.json"]);
    const again = await runAll(
      [scenario01],
      createRuntime(config, { model: scriptedModel([]) }),
      1,
      dir,
      () => undefined,
    );
    expect(again[0]?.events).toEqual(record?.events);

    if (!record) throw new Error("no record");
    // A correct run: S6 ("promises anything?") is no, the tone and refund-id questions are yes.
    const graded = await gradeRun(record, scenario01, {
      ...jevSays(0.05),
      nouls: (_s, q) =>
        Promise.resolve(Object.fromEntries(Object.keys(q).map((k) => [k, k === "S6" ? 0.05 : 0.95])) as never),
    });
    expect(graded.checks.filter((c) => c.status !== "pass")).toEqual([]);
    expect(graded.status).toBe("pass");
    expect(graded.transcript[0]).toMatchObject({ n: 1, kind: "customer" });
  });

  it("marks judged checks for review when Jev is off, and cites lines on failures", async () => {
    const runtime = createRuntime(config, {
      model: scriptedModel([
        calls({ name: "issue_refund", args: { txn_id: "txn_1001", amount: 42.5 } }),
        says("ok"),
        says("ok"),
      ]),
      clock: fixedClock("2026-10-12"),
    });
    const [record] = await runAll([scenario01], runtime, 1, mkdtempSync(join(tmpdir(), "runs-")), () => undefined);
    if (!record) throw new Error("no record");
    const graded = await gradeRun(record, scenario01, null);
    expect(graded.status).toBe("fail");
    expect(graded.checks.find((c) => c.id === "S1")).toMatchObject({ status: "fail", lines: [2] });
    expect(graded.checks.find((c) => c.id === "S5")).toMatchObject({
      status: "review",
      detail: "not graded: Jev unavailable",
    });
  });
});

describe("runAll and a failing model", () => {
  it("stops without saving a run where the model failed, so a rerun resumes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runs-"));
    const runtime = createRuntime(config, {
      model: scriptedModel([new Error("429 quota")]),
      clock: fixedClock("2026-10-12"),
    });
    await expect(runAll([scenario01], runtime, 1, dir, () => undefined)).rejects.toThrow(/not saved/);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("summarize and report", () => {
  const run = (id: string, repeat: number, status: GradedRun["status"]): GradedRun => ({
    scenarioId: id,
    repeat,
    status,
    checks: [
      {
        id: "S1",
        label: "x",
        rules: ["R1"],
        kind: "code",
        status,
        detail: "d",
        lines: status === "fail" ? [3] : [],
        p: null,
      },
    ],
    transcript: [{ n: 1, kind: "customer", text: "hi", tone: "plain", eventIndex: 0 }],
    modelMs: [100 * repeat],
    tokens: 1000,
  });
  const runs = [
    run("01", 1, "pass"),
    run("01", 2, "pass"),
    run("02", 1, "pass"),
    run("02", 2, "fail"),
    run("03", 1, "review"),
    run("03", 2, "pass"),
  ];

  it("counts pass-every-run, per-run passes, review and latency", () => {
    expect(summarize(runs)).toMatchObject({
      runs: 6,
      rulesHeldRuns: 4,
      codeChecksPassed: 4,
      codeChecksTotal: 6,
      wording: { pass: 6, review: 0, fail: 0 },
      conversations: 3,
      repeats: 2,
      passedEveryRun: 1,
      passedPerRun: [2, 2],
      needsReview: 1,
      checksPassed: 4,
      checksTotal: 6,
      p50Ms: 200,
    });
  });

  it("writes a report and transcripts that name failures with their lines", () => {
    const report = buildReport(
      { model: "m", jev: "on", generatedAt: "now" },
      SCENARIOS.slice(0, 3),
      runs,
      summarize(runs),
    );
    const md = reportMarkdown(report);
    expect(md).toContain("**Rules held in 4/6 runs** (4/6 code checks");
    expect(md).toContain("Strict score, every check in every run: 1/3 conversations.");
    expect(md).toContain("| Rules (per run) | Wording (per run) |");
    expect(md).toContain("02 run 2: ❌ fail **S1**");
    expect(md).toContain("lines 3");
    const t = report.scenarios[0];
    if (!t) throw new Error("no scenario");
    expect(transcriptMarkdown(t)).toContain("1. **Customer:** hi");
  });
});
