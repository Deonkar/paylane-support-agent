import { TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";

/** Pinned so thresholds tuned against this version don't drift when the `jev-latest` alias moves. */
export const JEV_MODEL = "jev-1.13.0";

export interface NoulQuestion {
  type: "noul";
  instructions: string | Record<string, unknown>;
  criteria?: { true: string; false: string };
}

export interface ScoreQuestion {
  type: "score";
  instructions: string | Record<string, unknown>;
  criteria: readonly string[];
}

export interface JevClient {
  /** Asks yes/no questions; returns the probability of "yes" per question, or null when Jev is unavailable. */
  nouls<K extends string>(
    state: unknown,
    questions: Readonly<Record<K, NoulQuestion>>,
  ): Promise<Record<K, number> | null>;
  /** Asks any mix of noul and score questions; returns the noul probability or the score value, or null. */
  ask<K extends string>(
    state: unknown,
    questions: Readonly<Record<K, NoulQuestion | ScoreQuestion>>,
  ): Promise<Record<K, number> | null>;
}

const answer = z.union([
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.object({ type: z.literal("score"), score: z.number() }),
]);
const response = z.object({ answers: z.record(z.string(), answer) });

export interface JevOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  warn?: (message: string) => void;
}

/**
 * A thin wrapper over the TypeSafe SDK. Every answer is validated with Zod; any failure (429, 529, timeout,
 * malformed answer, exhausted credit) becomes `null` plus a warning, and callers decide what that means.
 */
export function createJevClient(opts: JevOptions): JevClient {
  const client = new TypeSafeClient({
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 8_000,
    retry: { maxRetries: 2 },
    logLevel: "off",
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const warn =
    opts.warn ??
    ((m: string) => {
      console.warn(m);
    });
  const model = opts.model ?? JEV_MODEL;

  async function ask<K extends string>(
    state: unknown,
    questions: Readonly<Record<K, NoulQuestion | ScoreQuestion>>,
  ) {
    try {
      // The SDK's request type is generic over literal question shapes; our questions are validated data.
      const raw: unknown = await client.systemOne({ model, state, questions } as Parameters<
        typeof client.systemOne
      >[0]);
      const parsed = response.parse(raw);
      const out: Partial<Record<K, number>> = {};
      for (const key of Object.keys(questions) as K[]) {
        const a = parsed.answers[key];
        if (!a) throw new Error(`Jev returned no answer for ${key}`);
        out[key] = a.type === "noul" ? a.noul : a.score;
      }
      return out as Record<K, number>;
    } catch (err) {
      warn(
        `[jev] request failed, treating as unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  return { ask, nouls: ask };
}
