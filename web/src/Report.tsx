import { Ban, CircleCheck, CircleHelp } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Transcript } from "./Transcript.tsx";

const status = z.enum(["pass", "fail", "review"]);
const reportSchema = z.object({
  generatedAt: z.string(),
  model: z.string(),
  jev: z.string(),
  summary: z.object({
    conversations: z.number(),
    repeats: z.number(),
    passedEveryRun: z.number(),
    passedPerRun: z.array(z.number()),
    needsReview: z.number(),
    checksPassed: z.number(),
    checksTotal: z.number(),
    p50Ms: z.number(),
    p95Ms: z.number(),
    avgTokens: z.number(),
  }),
  scenarios: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.string(),
      why: z.string(),
      runs: z.array(
        z.object({
          repeat: z.number(),
          status,
          checks: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              rules: z.array(z.string()),
              kind: z.string(),
              status,
              detail: z.string(),
              lines: z.array(z.number()),
            }),
          ),
          transcript: z.array(
            z.object({
              n: z.number(),
              kind: z.enum(["customer", "agent", "note"]),
              text: z.string(),
              tone: z.enum(["plain", "allowed", "blocked", "handoff", "error"]),
              eventIndex: z.number(),
            }),
          ),
        }),
      ),
    }),
  ),
});
type ReportData = z.infer<typeof reportSchema>;
type Status = z.infer<typeof status>;

const WORD: Record<Status, string> = { pass: "Pass", fail: "Fail", review: "Review" };
const ICON: Record<Status, typeof Ban> = { pass: CircleCheck, fail: Ban, review: CircleHelp };

function Badge({ s }: { s: Status }) {
  const Icon = ICON[s];
  return (
    <span className={`badge ${s}`}>
      <Icon size={14} aria-hidden="true" /> {WORD[s]}
    </span>
  );
}

type Load = { state: "loading" } | { state: "missing" } | { state: "ready"; data: ReportData };

export function Report({ selected }: { selected: string | undefined }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [run, setRun] = useState(1);
  const [check, setCheck] = useState<string | null>(null);

  useEffect(() => {
    fetch("report.json")
      .then(async (r) => (r.ok ? reportSchema.parse(await r.json()) : null))
      .then((data) => {
        setLoad(data ? { state: "ready", data } : { state: "missing" });
      })
      .catch((err: unknown) => {
        console.warn("[report] could not load report.json", err);
        setLoad({ state: "missing" });
      });
  }, []);

  const ids = load.state === "ready" ? load.data.scenarios.map((s) => s.id) : [];
  useEffect(() => {
    setCheck(null);
    setRun(1);
  }, [selected]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || (e.key !== "j" && e.key !== "k") || e.target instanceof HTMLInputElement) return;
      const next = ids[ids.indexOf(selected) + (e.key === "j" ? 1 : -1)];
      if (next) window.location.hash = `#/report/${next}`;
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [selected, ids]);

  if (load.state === "loading") return <main className="empty">Loading results…</main>;
  if (load.state === "missing") {
    return (
      <main className="empty">
        <h1>No eval results yet</h1>
        <p>Run the twelve conversations and grade them:</p>
        <pre>pnpm eval --repeat 3</pre>
      </main>
    );
  }

  const { data } = load;
  const s = data.summary;
  const scenario = data.scenarios.find((x) => x.id === selected);

  if (!scenario) {
    return (
      <main className="report">
        <section className="headline">
          <h1>
            {s.passedEveryRun}/{s.conversations} conversations passed all {s.repeats} runs
          </h1>
          <p className="muted">
            Per run: {s.passedPerRun.join(" · ")}. Needs review: {s.needsReview}. Checks passed {s.checksPassed}/
            {s.checksTotal}. Model latency p50 {s.p50Ms} ms, p95 {s.p95Ms} ms. Agent {data.model}, graded by Jev (
            {data.jev}).
          </p>
        </section>
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Conversation</th>
              <th scope="col">Type</th>
              {Array.from({ length: s.repeats }, (_, k) => (
                <th key={k} scope="col">
                  Run {k + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.scenarios.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>
                  <a href={`#/report/${c.id}`}>{c.title}</a>
                </td>
                <td className="muted">{c.category}</td>
                {c.runs.map((r) => (
                  <td key={r.repeat}>
                    <Badge s={r.status} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    );
  }

  const current = scenario.runs.find((r) => r.repeat === run) ?? scenario.runs[0];
  const highlight = new Set(current?.checks.find((c) => c.id === check)?.lines ?? []);

  return (
    <main className="report detail-view">
      <p>
        <a href="#/report">← All conversations</a> <span className="muted">· J / K for next and previous</span>
      </p>
      <h1>
        {scenario.id}. {scenario.title}
      </h1>
      <p className="muted">
        {scenario.category}. {scenario.why}
      </p>
      <div className="runs" role="tablist" aria-label="Runs">
        {scenario.runs.map((r) => (
          <button
            key={r.repeat}
            type="button"
            role="tab"
            aria-selected={r.repeat === current?.repeat}
            onClick={() => {
              setRun(r.repeat);
            }}
          >
            Run {r.repeat} <Badge s={r.status} />
          </button>
        ))}
      </div>
      {current && (
        <div className="split">
          <div className="sheet">
            <Transcript lines={current.transcript} highlight={highlight} />
          </div>
          <ul className="checks" aria-label="Checks">
            {current.checks.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={check === c.id}
                  onClick={() => {
                    setCheck(check === c.id ? null : c.id);
                  }}
                >
                  <Badge s={c.status} />
                  <span className="check-label">
                    {c.label} <span className="muted">({c.rules.join(", ")})</span>
                  </span>
                  <span className="muted check-detail">
                    {c.detail}
                    {c.lines.length > 0 && ` · lines ${c.lines.join(", ")}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
