// Run and grade the twelve conversations: `pnpm eval [--repeat 3] [--only 06] [--fresh]`.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createJevClient } from "../jev/client.ts";
import { fixedClock } from "../policy/clock.ts";
import { createRuntime } from "../runtime.ts";
import { gradeRun, summarize } from "../eval/grade.ts";
import { buildReport, reportMarkdown, transcriptMarkdown } from "../eval/report.ts";
import { runAll } from "../eval/run.ts";
import { SCENARIOS } from "../eval/scenarios.ts";

const { values } = parseArgs({
  options: {
    repeat: { type: "string", default: "3" },
    only: { type: "string" },
    fresh: { type: "boolean", default: false },
  },
});
const repeats = Number(values.repeat);
if (!Number.isInteger(repeats) || repeats < 1) throw new Error("--repeat must be a positive integer");

const config = loadConfig();
// The eval pins "today" so the 30-day boundary is the same whenever it runs.
const runtime = createRuntime(config, { clock: fixedClock("2026-10-12") });
const jev = config.typesafeApiKey ? createJevClient({ apiKey: config.typesafeApiKey }) : null;
const scenarios = SCENARIOS.filter((s) => !values.only || s.id === values.only);

const runsDir = join("runs", runtime.model);
if (values.fresh) rmSync(runsDir, { recursive: true, force: true });
const records = await runAll(scenarios, runtime, repeats, runsDir);

const graded = [];
for (const r of records) {
  const scenario = scenarios.find((s) => s.id === r.scenarioId);
  if (scenario) graded.push(await gradeRun(r, scenario, jev));
}
const report = buildReport(
  { model: runtime.model, jev: runtime.jev === "on" ? "on" : "off", generatedAt: new Date().toISOString() },
  scenarios,
  graded,
  summarize(graded),
);

mkdirSync("eval/results/transcripts", { recursive: true });
writeFileSync("eval/results/report.json", JSON.stringify(report, null, 2));
writeFileSync("eval/results/report.md", reportMarkdown(report));
for (const c of report.scenarios) writeFileSync(`eval/results/transcripts/${c.id}.md`, transcriptMarkdown(c));
const s = report.summary;
console.log(
  `\n${s.passedEveryRun}/${s.conversations} passed every run · per run ${s.passedPerRun.join(", ")} · review ${s.needsReview} · checks ${s.checksPassed}/${s.checksTotal}`,
);
console.log("Wrote eval/results/report.md");
