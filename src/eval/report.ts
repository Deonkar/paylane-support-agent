import type { GradedRun, Status, Summary } from "./grade.ts";
import type { Scenario } from "./scenarios.ts";

export interface Report {
  generatedAt: string;
  model: string;
  jev: "on" | "off";
  summary: Summary;
  scenarios: { id: string; title: string; category: string; why: string; runs: GradedRun[] }[];
}

const MARK: Record<Status, string> = { pass: "✅ pass", fail: "❌ fail", review: "🟡 review" };

export function buildReport(
  meta: { model: string; jev: "on" | "off"; generatedAt: string },
  scenarios: readonly Scenario[],
  runs: readonly GradedRun[],
  summary: Summary,
): Report {
  return {
    ...meta,
    summary,
    scenarios: scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      category: s.category,
      why: s.why,
      runs: runs.filter((r) => r.scenarioId === s.id),
    })),
  };
}

export function reportMarkdown(r: Report): string {
  const s = r.summary;
  const out = [
    "# Eval report",
    "",
    `Model \`${r.model}\` · Jev ${r.jev} · ${s.conversations} conversations × ${s.repeats} runs · ${r.generatedAt}`,
    "",
    `**${s.passedEveryRun}/${s.conversations} conversations passed every run.** Per run: ${s.passedPerRun.join(", ")}. ` +
      `Needs review: ${s.needsReview}. Checks passed: ${s.checksPassed}/${s.checksTotal}. ` +
      `Model latency p50 ${s.p50Ms} ms, p95 ${s.p95Ms} ms. Average tokens per conversation: ${s.avgTokens}.`,
    "",
    "| # | Conversation | Type | Runs | Transcript |",
    "|---|---|---|---|---|",
    ...r.scenarios.map(
      (c) =>
        `| ${c.id} | ${c.title} | ${c.category} | ${c.runs.map((run) => MARK[run.status]).join(" · ")} | [${c.id}](transcripts/${c.id}.md) |`,
    ),
    "",
    "## Checks that did not pass",
    "",
  ];
  const misses = r.scenarios.flatMap((c) =>
    c.runs.flatMap((run) =>
      run.checks
        .filter((k) => k.status !== "pass")
        .map(
          (k) =>
            `- ${c.id} run ${run.repeat}: ${MARK[k.status]} **${k.id}** ${k.label} (${k.rules.join(", ")}): ${k.detail}${k.lines.length ? `, lines ${k.lines.join(", ")}` : ""}`,
        ),
    ),
  );
  out.push(...(misses.length ? misses : ["None."]), "");
  return out.join("\n");
}

export function transcriptMarkdown(c: Report["scenarios"][number]): string {
  const out = [`# ${c.id}. ${c.title}`, "", `**Type:** ${c.category}. **Why:** ${c.why}`, ""];
  for (const run of c.runs) {
    out.push(`## Run ${run.repeat}: ${MARK[run.status]}`, "");
    for (const l of run.transcript) {
      const who = l.kind === "customer" ? "**Customer:** " : l.kind === "agent" ? "**Agent:** " : "› _";
      out.push(`${l.n}. ${who}${l.text}${l.kind === "note" ? "_" : ""}`);
    }
    out.push("", "| Check | Result | Detail |", "|---|---|---|");
    for (const k of run.checks)
      out.push(
        `| ${k.id} ${k.label} | ${MARK[k.status]} | ${k.detail}${k.lines.length ? ` (lines ${k.lines.join(", ")})` : ""} |`,
      );
    out.push("");
  }
  return out.join("\n");
}
