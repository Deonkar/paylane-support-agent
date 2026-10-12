# Learnings

Non-obvious fixes and facts found while building this. Read before a task; add to it when something
surprises you.

## Toolchain

- **TypeScript 6.0.3, not 7.0.** typescript-eslint 8.71.1 supports `typescript >=4.8.4 <6.1.0`; TS 7 (the
  native compiler) breaks linting. Revisit when typescript-eslint widens its peer range.
- **Node 24 runs `.ts` directly.** It needs `.ts` extensions on relative imports, `import type` for types
  (`verbatimModuleSyntax`) and `erasableSyntaxOnly` (no own enums or parameter properties). SDK enums such
  as `FunctionCallingConfigMode` are fine: they are runtime values from the package.
- **Literal types from `as const` leak into "configurable" types.** `typeof POLICY` made `autoRefundLimitCents`
  the literal `7500`; a mapped `{ [K in keyof typeof POLICY]: number }` widens it for render functions.
- **`set -e` before chaining check and commit.** `pnpm typecheck | tail && git commit` commits on failure
  because the pipe's exit code is `tail`'s.
- **Heredocs with apostrophes break in Git Bash on Windows** in long commands; write source files with the
  editor tool instead.

## Gemini (`@google/genai` 2.28.0)

- `generateContent` + `functionDeclarations` with `parametersJsonSchema` works; tool calls come back as a
  `functionCall` part carrying `id` and a `thoughtSignature`. Replay the model's content unchanged and send
  the result as a `functionResponse` with the same `id`.
- Strip `$schema` from `z.toJSONSchema()` output before handing it over.
- The SDK retries 408, 429 and 5xx itself (`httpOptions.retryOptions`, default 5 attempts).
- Free-tier limits are only shown in AI Studio, not the docs. Google recommends temperature 1.0 for Gemini 3.

- **Free-tier capacity varies by model.** On 2026-10-12 `gemini-3.8-flash` returned 503 "high demand" and 504
  deadline errors (one success took 19s) while `gemini-3.5-flash-lite` answered in ~1.4s. The SDK retries
  5xx with backoff, which looks like a hang: set `httpOptions.timeout`. Default model is flash-lite.
- An empty `functionDeclarations: []` is pointless; omit `tools` when there are none.

## Jev (`@typesafe-ai/sdk` 0.6.0)

- Pin `jev-1.13.0`, not `jev-latest`, when thresholds are tuned against a version.
- Client options: `apiKey`, `timeout`, `retry: { maxRetries }`, `logLevel`, injectable `fetch` (handy for tests).

## Server

- `fetch` (undici) won't send a custom `Host` header and normalises paths; test Host checks and traversal with
  raw `node:http` requests.
- On Windows `path.normalize("/../x")` collapses back to `\x`, so traversal quietly falls through to the index.
  Reject decoded paths containing `..` explicitly instead of relying on normalisation.
- `erasableSyntaxOnly` forbids constructor parameter properties (`constructor(readonly status: number)`);
  declare the field and assign it.

## Eval

- **The first full eval hit 429 RESOURCE_EXHAUSTED: 15 requests/minute per model on the free tier.** The SDK's
  short retries can't wait out a per-minute window, so the agent's safe fallback (reply + handoff) fired in
  a third of runs: correct behaviour, useless measurement. Fixed with a sliding-window limiter (`GEMINI_RPM`,
  default 14). Lesson: a cut "you won't need it" component came back once real traffic arrived.
- **The free tier also has a daily cap: 500 requests per model per day** for flash-lite. A full 12 × 3 eval is
  roughly 275 calls, so two full runs exhaust a day. Each model has its own quota.
- **A prompt rule the model ignores 3 times out of 3 belongs in code.** The card-number warning went from 0/3 to
  3/3 once the loop added it, with no prompt change.
- **A warmer prompt is not automatically better.** Asking for names and acknowledgement made replies warmer, but
  also added soft promises ("it should show up soon") that pushed the no-false-promises check into review in
  5 more runs, while Jev's tone score didn't move (0.50 → 0.48). Reverted; measured, not assumed.
