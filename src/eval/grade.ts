import type { JevClient, NoulQuestion } from "../jev/client.ts";
import type { RuleId } from "../policy/rulebook.ts";
import type { TraceEvent } from "../shared/events.ts";
import { type TranscriptLine, toTranscriptLines } from "../shared/transcript.ts";
import { type JevCheck, linesFor } from "./checks.ts";
import type { Scenario } from "./scenarios.ts";

export type Status = "pass" | "fail" | "review";

export interface RunRecord {
  scenarioId: string;
  repeat: number;
  model: string;
  jev: "on" | "off";
  events: TraceEvent[];
}

export interface CheckResult {
  id: string;
  label: string;
  rules: RuleId[];
  kind: "code" | "jev";
  status: Status;
  detail: string;
  lines: number[];
  /** Jev's probability of "yes", for judged checks. */
  p: number | null;
}

export interface GradedRun {
  scenarioId: string;
  repeat: number;
  status: Status;
  checks: CheckResult[];
  transcript: TranscriptLine[];
  modelMs: number[];
  tokens: number;
}

/** Below 0.2 reads as "no", above 0.8 as "yes"; anything between is not decided and goes to a person. */
export const JEV_BANDS = { no: 0.2, yes: 0.8 } as const;

export function bandStatus(p: number, passWhen: "yes" | "no"): Status {
  if (p > JEV_BANDS.no && p < JEV_BANDS.yes) return "review";
  return p >= JEV_BANDS.yes === (passWhen === "yes") ? "pass" : "fail";
}

function conversation(events: readonly TraceEvent[]) {
  return events.flatMap((e) =>
    e.type === "customer_message"
      ? [{ from: "customer", text: e.text }]
      : e.type === "agent_message"
        ? [{ from: "agent", text: e.text }]
        : [],
  );
}

async function judge(
  checks: JevCheck[],
  events: readonly TraceEvent[],
  jev: JevClient | null,
): Promise<Map<string, number> | null> {
  if (!jev || checks.length === 0) return null;
  const convo = conversation(events);
  const state = { conversation: convo, first_agent_reply: convo.find((m) => m.from === "agent")?.text ?? "" };
  const questions: Record<string, NoulQuestion> = {};
  for (const c of checks) {
    questions[c.id] = {
      type: "noul",
      instructions: c.firstReplyOnly
        ? `About the support agent's reply in \`first_agent_reply\`: ${c.question}`
        : `In \`conversation\` between a Paylane customer and the support agent: ${c.question}`,
    };
  }
  const answers = await jev.nouls(state, questions);
  return answers ? new Map(Object.entries(answers)) : null;
}

export async function gradeRun(
  record: RunRecord,
  scenario: Scenario,
  jev: JevClient | null,
): Promise<GradedRun> {
  const { events } = record;
  const judged = await judge(
    scenario.checks.filter((c): c is JevCheck => c.kind === "jev"),
    events,
    jev,
  );
  const checks = scenario.checks.map((c): CheckResult => {
    const base = { id: c.id, label: c.label, rules: c.rules, kind: c.kind };
    if (c.kind === "code") {
      const r = c.run(events);
      return {
        ...base,
        status: r.pass ? "pass" : "fail",
        detail: r.detail,
        lines: r.pass ? [] : linesFor(events, r.eventIndexes),
        p: null,
      };
    }
    const p = judged?.get(c.id);
    if (p === undefined)
      return { ...base, status: "review", detail: "not graded: Jev unavailable", lines: [], p: null };
    return { ...base, status: bandStatus(p, c.passWhen), detail: `p(yes) = ${p.toFixed(2)}`, lines: [], p };
  });
  const status: Status = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "review")
      ? "review"
      : "pass";
  const calls = events.filter((e) => e.type === "model_call");
  return {
    scenarioId: record.scenarioId,
    repeat: record.repeat,
    status,
    checks,
    transcript: toTranscriptLines(events),
    modelMs: calls.map((e) => e.ms),
    tokens: calls.reduce((n, e) => n + e.inputTokens + e.outputTokens, 0),
  };
}

function percentile(sorted: number[], q: number): number {
  return sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0) : 0;
}

export interface Summary {
  conversations: number;
  repeats: number;
  /** Conversations that passed every run: the headline. */
  passedEveryRun: number;
  passedPerRun: number[];
  needsReview: number;
  checksPassed: number;
  checksTotal: number;
  p50Ms: number;
  p95Ms: number;
  avgTokens: number;
}

export function summarize(runs: readonly GradedRun[]): Summary {
  const ids = [...new Set(runs.map((r) => r.scenarioId))];
  const repeats = Math.max(0, ...runs.map((r) => r.repeat));
  const byId = (id: string) => runs.filter((r) => r.scenarioId === id);
  const ms = runs.flatMap((r) => r.modelMs).sort((a, b) => a - b);
  const checks = runs.flatMap((r) => r.checks);
  return {
    conversations: ids.length,
    repeats,
    passedEveryRun: ids.filter((id) => byId(id).every((r) => r.status === "pass")).length,
    passedPerRun: Array.from(
      { length: repeats },
      (_, k) => runs.filter((r) => r.repeat === k + 1 && r.status === "pass").length,
    ),
    needsReview: ids.filter(
      (id) => byId(id).some((r) => r.status === "review") && !byId(id).some((r) => r.status === "fail"),
    ).length,
    checksPassed: checks.filter((c) => c.status === "pass").length,
    checksTotal: checks.length,
    p50Ms: percentile(ms, 0.5),
    p95Ms: percentile(ms, 0.95),
    avgTokens: runs.length ? Math.round(runs.reduce((n, r) => n + r.tokens, 0) / runs.length) : 0,
  };
}
