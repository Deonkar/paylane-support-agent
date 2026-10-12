import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { respond } from "../agent/loop.ts";
import type { createRuntime } from "../runtime.ts";
import { traceEvent } from "../shared/events.ts";
import type { RunRecord } from "./grade.ts";
import type { Scenario } from "./scenarios.ts";

type Runtime = ReturnType<typeof createRuntime>;

const runRecord = z.object({
  scenarioId: z.string(),
  repeat: z.number().int().positive(),
  model: z.string(),
  jev: z.enum(["on", "off"]),
  events: z.array(traceEvent),
});

export async function runScenario(s: Scenario, runtime: Runtime, repeat: number): Promise<RunRecord> {
  const { session, deps } = runtime.newChat(`${s.id}.${repeat}`);
  for (const turn of s.turns) await respond(session, turn, deps);
  return {
    scenarioId: s.id,
    repeat,
    model: runtime.model,
    jev: runtime.jev === "on" ? "on" : "off",
    events: session.events,
  };
}

/** Runs each scenario `repeats` times, saving every trace; an existing trace is reused, so a quota error loses nothing. */
export async function runAll(
  scenarios: readonly Scenario[],
  runtime: Runtime,
  repeats: number,
  dir: string,
  log = console.log,
): Promise<RunRecord[]> {
  mkdirSync(dir, { recursive: true });
  const records: RunRecord[] = [];
  for (const s of scenarios) {
    for (let k = 1; k <= repeats; k++) {
      const file = join(dir, `${s.id}.${k}.json`);
      if (existsSync(file)) {
        records.push(runRecord.parse(JSON.parse(readFileSync(file, "utf8"))));
        log(`${s.id}.${k} reused`);
        continue;
      }
      const record = await runScenario(s, runtime, k);
      // A run where the model itself failed (quota, outage) measures the provider, not the agent: never save or
      // grade it. Stop here; rerunning resumes from this run once the model is back.
      if (record.events.some((e) => e.type === "fallback" && e.reason === "model_error")) {
        throw new Error(
          `${s.id}.${k}: the model call failed (quota or outage), so the run was not saved. Rerun to resume.`,
        );
      }
      writeFileSync(file, JSON.stringify(record, null, 2));
      records.push(record);
      log(`${s.id}.${k} done`);
    }
  }
  return records;
}
