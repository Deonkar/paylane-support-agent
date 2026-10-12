# Paylane support agent: implementation plan

> Executed inline by the author, test-first, one commit per task. Deviation from the writing-plans template,
> stated on purpose: steps name the tests to write first and the exact interfaces, instead of pasting every
> line of code twice. The interfaces below are the contract between tasks; the tests are the specification.

**Goal:** the agent, tools, eval and UI described in [spec.md](spec.md), shipped as a public repo with CI.

**Architecture:** the model talks, Jev judges, the code decides. A tool gateway enforces every checkable
rule before the mock Paylane API is touched; Jev flags the semantic triggers; Gemini holds the conversation.
One event schema feeds the server stream, the eval grader, the transcripts and both screens.

**Tech stack:** Node 24 (runs TypeScript directly), TypeScript 6.0.3 strict, pnpm, Zod 4.6.6,
`@google/genai` 2.28.0, `@typesafe-ai/sdk` 0.6.0, Vitest 5, fast-check, ESLint 10 + typescript-eslint 8.71.1,
React 19.3 + Vite 8, Testing Library, Playwright 1.64 + axe.

**Spec:** [docs/spec.md](spec.md). UI direction contract: `.impeccable/surfaces/web-src-playground-playground-tsx.md`.

## Global constraints

- Node 24 runs `.ts` directly: relative imports carry the `.ts` extension, `import type` for types,
  `erasableSyntaxOnly` (no `enum`, `namespace` or constructor parameter properties of our own).
- TypeScript 6.0.3, because typescript-eslint 8.71.1 supports `<6.1`. `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noEmit`, `allowImportingTsExtensions`.
- Exact version pins; one lockfile; `packageManager` field set; `engines.node >= 24`.
- Money is integer cents in variables named `...Cents`. Dollars appear only in API JSON and in display text.
- Data from outside the process (model output, tool arguments, Jev answers, HTTP bodies, env, report JSON)
  is parsed with Zod. No `as` casts on it.
- No silent failures: no empty `catch`, no `.catch(() => {})`. Rethrow, return a typed failure, or record an
  event and log at warn with context.
- Keys come only from `.env` (loaded with `process.loadEnvFile`), are never logged, never sent to the
  browser, never written to traces.
- No `utils/`, `helpers/`, `common/` or `misc/` folders. Extract on the second real use.
- Line endings LF (`.gitattributes`). Commit messages: conventional prefix, imperative.
- Every test runs offline with no keys. Live calls only in `pnpm eval:run`, `pnpm chat`, `pnpm playground`,
  `pnpm smoke:gemini`, `pnpm jev:*`.

---

## Shared types (the contract every task builds on)

```ts
// src/policy/clock.ts
export interface Clock { today(): string /* YYYY-MM-DD, UTC */ ; nowMs(): number }
export function fixedClock(isoDate: string): Clock
export const systemClock: Clock

// src/policy/money.ts
export type AmountParse = { ok: true; cents: number } | { ok: false; reason: "not_a_number" | "not_positive" | "fractional_cents" | "too_large" }
export function parseDollars(amount: number): AmountParse      // 42.5 -> 4250; rejects 0, -1, 1.005, NaN, > 1e9
export function centsToDollars(cents: number): number           // 4250 -> 42.5
export function formatUsd(cents: number): string                 // 4250 -> "$42.50", 1800000 -> "$18,000.00"

// src/policy/rulebook.ts
export const RULES: readonly { id: RuleId; text: string; enforcedBy: "code" | "code + API" | "code + prompt" | "Jev + code" | "prompt + eval" }[]
export type RuleId = "R1" | "R2" | ... | "R14"
export function renderRulebook(): string                         // the numbered rule text the prompt embeds

// src/policy/refund-policy.ts
export const POLICY = { autoRefundLimitCents: 7_500, maxRefundAgeDays: 30, maxVerifyAttempts: 3, fraudPriorityCents: 50_000 } as const
export type HandoffReason = "fraud" | "legal" | "closure" | "override"
export type RefundBlockReason = "not_verified" | "not_found" | "needs_human" | "safety_check_unavailable" | "account_frozen"
  | "already_refunded" | "not_settled" | "partial_refund" | "over_limit" | "too_old"
export type RefundDecision = { allow: true } | { allow: false; reason: RefundBlockReason; rule: RuleId; next: "verify" | "check_id" | "hand_off" | "explain" }
export interface RefundContext {
  verified: boolean
  customer: { id: string; status: "active" | "frozen" } | null
  txn: { customerId: string; amountCents: number; date: string; status: "settled" | "pending" | "refunded" } | null
  requestedCents: number
  today: string
  handoff: HandoffReason | null            // sticky Jev flag for the chat
  safetyCheck: "ok" | "unavailable" | "off"
}
export function decideRefund(ctx: RefundContext): RefundDecision   // first failing check wins, order as listed in RefundBlockReason
export function ageInDays(date: string, today: string): number      // whole UTC calendar days

// src/paylane/types.ts  (spec-shaped JSON)
export interface CustomerRecord { id: string; name: string; email: string; card_last4: string; status: "active" | "frozen" }
export interface TransactionRecord { id: string; customer_id: string; amount_cents: number; date: string; merchant: string
  status: "settled" | "pending" | "refunded"; refund_id?: string; fault?: "processor_unavailable" }
export interface PaylaneApi {
  get_customer(i: { email: string }): Promise<{ id: string; name: string; card_last4: string; status: "active" | "frozen"; verified: false } | { error: "not_found" }>
  get_transaction(i: { customer_id: string; txn_id: string }): Promise<{ amount: number; date: string; merchant: string; status: "settled" | "pending" | "refunded" } | { error: "not_found" }>
  issue_refund(i: { txn_id: string; amount: number }): Promise<{ ok: true; refund_id: string } | { ok: false; reason: "not_found" | "already_refunded" | "not_settled" | "invalid_amount" | "processor_unavailable" }>
  escalate_to_human(i: { customer_id: string | null; summary: string }): Promise<{ ticket_id: string }>
}

// src/shared/events.ts  (Zod schemas; TraceEvent = z.infer)
type TraceEvent =
  | { type: "customer_message"; turn: number; text: string; redactions: number }
  | { type: "signals"; turn: number; status: "ok" | "unavailable" | "off"; readings: Record<SignalKey, number> | null; flagged: HandoffReason[] }
  | { type: "tool_call"; turn: number; callId: string; tool: ToolName; args: Record<string, unknown>; result: Record<string, unknown>
      outcome: "ok" | "blocked" | "error"; block: { reason: string; rule: RuleId } | null; ms: number }
  | { type: "model_call"; turn: number; model: string; ms: number; inputTokens: number; outputTokens: number }
  | { type: "agent_message"; turn: number; text: string; masked: number }
  | { type: "fallback"; turn: number; reason: "step_limit" | "model_error" }
type SignalKey = "fraud_report" | "legal_threat" | "closure_request" | "override_attempt"
type ToolName = "get_customer" | "get_transaction" | "issue_refund" | "escalate_to_human"

// src/shared/transcript.ts
export interface TranscriptLine { n: number; kind: "customer" | "agent" | "note"; text: string; tone: "plain" | "allowed" | "blocked" | "handoff" | "error"; eventIndex: number }
export function toTranscriptLines(events: readonly TraceEvent[]): TranscriptLine[]   // numbering used by UI, markdown transcripts and check citations
export function describeToolCall(e: ToolCallEvent): { text: string; tone: TranscriptLine["tone"] }  // "Refund not allowed: over the $75 limit (R4)"

// src/llm/types.ts
export interface ToolCall { id: string; name: string; args: unknown }
export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; raw: unknown }      // raw = provider content, replayed verbatim
  | { role: "tool"; results: { id: string; name: string; result: Record<string, unknown> }[] }
export interface ToolSpec { name: ToolName; description: string; parameters: Record<string, unknown> /* JSON Schema */ }
export interface ModelReply { text: string; toolCalls: ToolCall[]; raw: unknown; inputTokens: number; outputTokens: number }
export interface ChatModel { readonly name: string; generate(req: { system: string; tools: readonly ToolSpec[]; history: readonly Turn[] }): Promise<ModelReply> }

// src/jev/signals.ts
export interface SignalVerdict { status: "ok" | "unavailable" | "off"; readings: Record<SignalKey, number> | null; flagged: HandoffReason[] }
export interface SignalClassifier { classify(conversation: readonly { from: "customer" | "agent"; text: string }[]): Promise<SignalVerdict> }

// src/agent/session.ts
export interface Session {
  id: string; customerHint: string | null
  verified: { id: string; name: string; email: string; status: "active" | "frozen" } | null   // email stays server-side, used for masking
  failedVerifications: number; handoff: HandoffReason | null; ticketId: string | null
  turn: number; history: Turn[]; events: TraceEvent[]
}
```

---

### Task 1: Scaffold, tooling and CI

**Files:** `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `web/tsconfig.json`, `eslint.config.js`,
`.prettierrc.json`, `vitest.config.ts`, `.nvmrc`, `.github/workflows/ci.yml`, `test/smoke.test.ts`

- [ ] Write `test/smoke.test.ts` asserting `1 + 1 === 2` through an import of a `.ts` file, to prove the
      Node TypeScript and Vitest wiring.
- [ ] Add pinned dev dependencies and scripts: `test`, `test:coverage`, `lint`, `typecheck`, `format`,
      `check` (lint + typecheck + test), `audit` (`pnpm audit --prod`).
- [ ] `pnpm check` passes; `node --input-type=module -e "import('./test/smoke.test.ts')"` is not needed,
      but `node src/...ts` must run once a source file exists.
- [ ] CI: checkout, pnpm setup, Node 24, `pnpm install --frozen-lockfile`, lint, typecheck, test with
      coverage, `pnpm audit --prod`, gitleaks. Actions pinned by commit SHA; `permissions: contents: read`.
- [ ] Commit `chore: scaffold TypeScript, tests, lint and CI`.

**Accept:** `pnpm check` green locally; the workflow file passes `actionlint`-style review by eye.

### Task 2: Money and clock

**Files:** `src/policy/money.ts`, `src/policy/clock.ts`, `test/policy/money.test.ts`, `test/policy/clock.test.ts`

- [ ] Tests first: `parseDollars(42.5)` gives 4250; `parseDollars(75)` gives 7500; `0.1 + 0.2` style input
      `0.30000000000000004` gives 30; rejects `0`, `-1`, `1.005` (fractional cents), `NaN`, `Infinity`,
      `1e10`. `formatUsd(7500)` is `"$75.00"`, `formatUsd(1800000)` is `"$18,000.00"`. `fixedClock` returns
      its date; `systemClock.today()` matches `/^\d{4}-\d{2}-\d{2}$/`.
- [ ] Implement; tests pass; commit `feat: integer-cent money and an injectable clock`.

### Task 3: Policy and rulebook

**Files:** `src/policy/refund-policy.ts`, `src/policy/rulebook.ts`, `test/policy/refund-policy.test.ts`,
`test/policy/rulebook.test.ts`

- [ ] Table tests for `decideRefund`, one row per reason, each asserting `reason`, `rule` and `next`, plus:
      $75.00 at 29 days allowed; $75.01 `over_limit`; 30 days `too_old`; 29 days allowed; pending
      `not_settled`; refunded `already_refunded`; frozen `account_frozen`; another customer's txn `not_found`;
      `requestedCents` 7500 on an 18000 txn `partial_refund`; `handoff: "fraud"` beats an otherwise eligible
      $60 refund; `handoff: "override"` cites R10, the others R9; `safetyCheck: "unavailable"` blocks;
      `"off"` does not.
- [ ] `ageInDays`: same day 0, across a month end, across 29 Feb 2028, never negative for future dates (0).
- [ ] fast-check properties: for any `amountCents` in 1..7500 and age 0..29 with nothing else wrong, allowed;
      for any amount above 7500, never allowed; for any age 30+, never allowed.
- [ ] Rulebook tests: 14 rules, ids R1..R14 in order; `renderRulebook()` contains `"$75"` and `"30 days"`
      derived from `POLICY` (change the constant in the test via a pure render function to prove it);
      every `RefundBlockReason` maps to a rule that exists.
- [ ] Implement; commit `feat: refund policy as pure code, rulebook rendered from the same constants`.

### Task 4: Mock Paylane API, store and fixtures

**Files:** `src/paylane/types.ts`, `src/paylane/fixtures.ts`, `src/paylane/store.ts`, `src/paylane/api.ts`,
`test/paylane/api.test.ts`

Fixtures: 13 customers (`cus_01`..`cus_12` for the scenarios, `cus_13` Lee Morgan for conversation 7), all
`@example.com`, transactions as in spec section 4, dates from `daysAgo` against the clock.

- [ ] Tests first: `get_customer` lowercases and trims email, returns `verified: false` always, unknown email
      gives `{ error: "not_found" }`; `get_transaction` with another customer's id gives `not_found`; amounts
      come back in dollars; `issue_refund` happy path returns `rf_0001` and flips status to `refunded`;
      a second call gives `already_refunded`; `Promise.all` of two refunds on one txn gives exactly one
      `ok`; amount above the txn amount, zero, or fractional cents gives `invalid_amount`; pending gives
      `not_settled`; `fault: "processor_unavailable"` gives that reason and leaves the txn settled;
      `escalate_to_human` accepts `customer_id: null` and returns `tk_0001`, then `tk_0002`; two stores
      never share state.
- [ ] Implement `createStore(fixtures, clock)` and `createPaylaneApi(store)`; commit
      `feat: mock Paylane API with scoped lookups and once-only refunds`.

### Task 5: Redaction

**Files:** `src/agent/redact.ts`, `test/agent/redact.test.ts`

- [ ] Tests first: `redactCardNumbers` turns `4000 0566 5566 5556`, `4000-0566-5566-5556` and
      `4000056655665556` into `[card ending 5556]` with `count: 1`; leaves alone a Luhn-invalid 16-digit
      number, `txn_6001`, `card ending 6623`, a phone number, `2026-10-12`, `$180.00`; handles two cards in one
      message. `maskEmails` turns `marcus.hill@example.com` into `m•••@example.com` and counts it.
- [ ] Implement with a digit-run regex plus Luhn; commit `feat: card-number redaction and email masking`.

### Task 6: Shared events and transcript lines

**Files:** `src/shared/events.ts`, `src/shared/transcript.ts`, `test/shared/transcript.test.ts`

- [ ] Tests first: every event variant round-trips through its Zod schema; unknown `type` is rejected;
      `toTranscriptLines` numbers lines from 1 in event order, skips `model_call`, gives one line per tool
      call note and per message; `describeToolCall` produces the exact plain sentences for: verified,
      not verified, locked, transaction found, refund issued, refund not allowed for each reason (with the
      rule id), refund failed at the processor, handed to a person (with ticket), invalid arguments.
- [ ] Implement; commit `feat: one event schema and transcript numbering shared by every surface`.

### Task 7: Session, tool gateway and attack suite

**Files:** `src/agent/session.ts`, `src/agent/tools.ts`, `test/agent/tools.test.ts`,
`test/agent/attacks.test.ts`

Interface: `export const TOOL_SPECS: readonly ToolSpec[]` (JSON Schema from Zod via `z.toJSONSchema`) and
`export async function runTool(session: Session, call: ToolCall, deps: { api: PaylaneApi; clock: Clock; signals: () => Promise<SignalVerdict> }): Promise<Extract<TraceEvent, { type: "tool_call" }>>`.

- [ ] Tests first (`tools.test.ts`): `get_customer` with matching email and last 4 verifies and returns
      `{ id, name, status, verified: true }` with no `card_last4` and no email in the result; wrong digits and
      unknown email return the identical error object; third failure locks (`verification_locked`); a second
      successful verification as a different customer is refused (R3); `get_transaction` before
      verification is blocked (R1); with a foreign `customer_id` is blocked (R3); success adds `age_days` and
      `refund_check`; `issue_refund` blocked paths never call the API (spy); allowed path calls it once;
      `escalate_to_human` redacts card numbers in the summary, caps it at 1,000 characters, returns the same
      ticket on a repeat; invalid arguments give `invalid_arguments` and outcome `error`.
- [ ] Attack suite (`attacks.test.ts`), a list of forbidden calls each asserting `outcome: "blocked"` or
      `"error"` and an API untouched: refund before verification, someone else's txn, $340, $75 of $180,
      `-5`, `0.001`, a second refund, mismatched `customer_id`, card number in a summary, unknown tool name,
      extra argument fields, a 10 KB summary.
- [ ] Implement; commit `feat: tool gateway enforcing verification, session binding and the refund policy`.

### Task 8: Jev client and runtime signals

**Files:** `src/jev/client.ts`, `src/jev/signals.ts`, `test/jev/signals.test.ts`

- [ ] Tests first, through the SDK's injectable `fetch`: four readings parsed and validated; a reading of
      0.6 on fraud flags `fraud` (threshold 0.5); flags are returned in a stable order; 429 then exhaustion
      gives `status: "unavailable"`; malformed JSON gives `unavailable`; no client (no key) gives `off`
      without any request; a timeout above `timeoutMs` gives `unavailable`; the request uses `jev-1.13.0`
      and an object state with named fields.
- [ ] Implement; commit `feat: Jev trigger signals with fail-closed and feature-off modes`.

### Task 9: Agent loop with a scripted model

**Files:** `src/llm/types.ts`, `src/llm/scripted.ts`, `src/agent/loop.ts`, `test/agent/loop.test.ts`

Interface: `export async function respond(session: Session, text: string, deps: AgentDeps, emit?: (e: TraceEvent) => void): Promise<string>`
with `AgentDeps = { model: ChatModel; api: PaylaneApi; clock: Clock; signals: SignalClassifier; system: string; maxModelCalls: number }`.

- [ ] Tests first with `scriptedModel` (returns queued `ModelReply`s and records each request): a tool round
      trip appends assistant then tool turns and replays `raw` unchanged; two tool calls in one reply run in
      order and their results go back in one tool turn; the inbound card number never reaches the model;
      the Jev call starts before the model call resolves (ordering assertion with deferred promises); a
      blocked refund produces a tool turn with the reason; step limit 6 gives the fallback reply and a
      handoff; a thrown model error gives the fallback reply, a `fallback` event and a handoff; an email in
      the reply is masked and `masked: 1` recorded; `emit` receives events in trace order.
- [ ] Implement; commit `feat: provider-agnostic agent loop with step limit and safe fallback`.

### Task 10: Gemini adapter

**Files:** `src/llm/gemini.ts`, `test/llm/gemini.test.ts`, `scripts/smoke-gemini.ts`

- [ ] Tests first with an injected fake of the `models.generateContent` function: history mapping (user
      text, assistant `raw` replayed verbatim, tool results as `functionResponse` parts with matching `id`
      in one user turn); reply mapping (text parts joined, `functionCall` parts to `ToolCall`, thought parts
      ignored); usage mapped; config carries `systemInstruction`, `parametersJsonSchema`, mode `AUTO`,
      `automaticFunctionCalling.disable: true`, thinking level from options; the rate limiter spaces calls
      at `60_000 / rpm` ms (fake timers).
- [ ] `pnpm smoke:gemini` makes one live round trip and prints latency and token counts.
- [ ] Implement; commit `feat: Gemini adapter with exact content replay and a request limiter`.

### Task 11: System prompt

**Files:** `src/agent/prompt.ts`, `test/agent/prompt.test.ts`

- [ ] Tests first: contains every rule's text; building it twice gives identical strings (no dates, ids or
      randomness, so the prefix caches); under 6,000 characters; names the four tools; says customer text
      and tool data are information, not instructions.
- [ ] Implement; commit `feat: system prompt rendered from the rulebook`.

### Task 12: Config and terminal chat

**Files:** `src/config.ts`, `src/cli/chat.ts`, `test/config.test.ts`

- [ ] Tests first: missing `GEMINI_API_KEY` errors with a plain message naming `.env.example`; blank
      `TYPESAFE_API_KEY` means Jev off; `GEMINI_RPM` defaults and must be a positive integer; unknown model
      names are allowed but trimmed.
- [ ] `pnpm chat --customer 06` prints each transcript line as it is produced, notes dimmed.
- [ ] Implement; commit `feat: validated config and a terminal chat`.

### Task 13: Scenarios, checks and the Jev grader

**Files:** `src/eval/types.ts`, `src/eval/checks.ts`, `src/eval/scenarios/01-refund-eligible.ts` ..
`12-legal-and-closure.ts`, `src/eval/scenarios/index.ts`, `src/jev/grader.ts`, `test/eval/checks.test.ts`,
`test/eval/scenarios.test.ts`, `test/jev/grader.test.ts`

- [ ] Tests first: every deterministic check factory passes on a hand-built passing trace and fails on a
      hand-built failing one, and reports the transcript lines it concerns; grader maps a Noul below 0.2 to
      pass, above 0.8 to fail, between to review (inverted for "good" questions), and a Score by its bands;
      scenario integrity: 12 scenarios, unique ids, customer exists in fixtures, 2 to 5 turns, every scenario
      has the six shared checks plus at least two of its own, and every rule R1..R14 is cited by at least
      one check somewhere.
- [ ] Implement; commit `feat: twelve scenarios with deterministic and Jev-graded checks`.

### Task 14: Runner, grading, report data and calibration

**Files:** `src/eval/run.ts`, `src/eval/grade.ts`, `src/eval/report.ts`, `src/eval/calibration.ts`,
`src/cli/eval.ts`, `src/shared/report-schema.ts`, `test/eval/run.test.ts`, `test/eval/grade.test.ts`

- [ ] Tests first with the scripted model and a fake grader: a run writes `runs/<runId>/<scenario>.<k>.json`;
      a resumed run skips existing files; grading produces per-check statuses and a scenario status;
      pass^3 counts only scenarios passing all three repeats; latency p50 and p95 from `model_call`
      events; `report.json` validates against `report-schema.ts`; the markdown transcript matches a snapshot.
- [ ] `pnpm jev:calibrate` scores the labelled set and prints agreement at the chosen thresholds.
- [ ] Implement; commit `feat: resumable eval runs, grading, report data and Jev calibration`.

### Task 15: Local server and event stream

**Files:** `src/server/http.ts`, `src/server/routes.ts`, `src/server/sse.ts`, `src/cli/playground.ts`,
`test/server/http.test.ts`

- [ ] Tests first against a real server on an ephemeral port with the scripted model: `GET /api/customers`
      lists fixtures; `POST /api/sessions` creates one; `POST /api/sessions/:id/messages` streams events then
      `done`; malformed body 400; body over 4 KB 413; unknown session 404; 21st message in a minute 429;
      a `Host` header other than localhost or 127.0.0.1 is 403 (DNS rebinding); responses carry the CSP,
      `nosniff` and `no-referrer` headers; nothing in any response matches a key pattern.
- [ ] Implement; commit `feat: localhost-only server streaming agent events`.

### Task 16: Web foundation

**Files:** `web/index.html`, `web/vite.config.ts`, `web/src/main.tsx`, `web/src/router.ts`,
`web/src/ui/tokens.css`, `web/src/ui/Note.tsx`, `web/src/ui/Transcript.tsx`, `web/src/ui/ProbabilityLine.tsx`,
component tests beside them

- [ ] Load the craft floor and the direction contract before any UI code.
- [ ] Tests first: `Transcript` renders an ordered list with the shared line numbers; a blocked note shows
      the struck word, an icon and the word "not allowed" (never colour alone); `ProbabilityLine` exposes the
      value as text ("2% likely") and marks the 0.5 hand-off line; router maps `#/`, `#/report`,
      `#/report/06`.
- [ ] Self-hosted Public Sans variable font; tokens as CSS custom properties; themed selection, focus ring,
      scrollbar and tabular numerals.
- [ ] Implement; commit `feat: web foundation in the annotated-transcript direction`.

### Task 17: Playground screen

**Files:** `web/src/playground/*`, `e2e/playground.spec.ts`

- [ ] Tests first: picking a customer shows their synthetic facts; sending streams notes in; the Why panel
      follows the selected note; states for empty, working, error and Jev off; Playwright drives the scripted
      model server at 1440 and 390 widths.
- [ ] Implement; commit `feat: Playground with live notes and the Why panel`.

### Task 18: Eval report screen and Pages build

**Files:** `web/src/report/*`, `e2e/report.spec.ts`, `.github/workflows/pages.yml`

- [ ] Tests first: headline shows pass^3 from `report.json`; grid cells carry icon plus word; opening a
      conversation lists its checks, and following a check highlights its lines; J and K move between
      conversations; filters for failed and needs review; axe reports no violations at 1440 and 390.
- [ ] Pages workflow builds the static report on push to main.
- [ ] Implement; commit `feat: static eval report with line-cited checks`.

### Task 19: UI verification and design finish

- [ ] Open both screens in the browser at desktop and mobile widths; fix in one batch; confirm once.
- [ ] Re-ask Jev the direction questions about the built screens (text description plus the rendered DOM
      text); the generic score must come down from 0.45 or the gap gets named.
- [ ] `impeccable detect` on changed targets; design audit (touch targets, hierarchy, rhythm, type scale,
      cognitive load); finish review; write `DESIGN.md` from the built world.
- [ ] Commit `docs: design system recorded from the built UI`.

### Task 20: Live eval, the failure and the fix

- [ ] `pnpm jev:calibrate`; then `pnpm eval:run --repeat 3` on `gemini-3.8-flash`; once more on
      `gemini-3.5-flash-lite` and once at thinking `medium`, as quota allows; `pnpm eval:grade`.
- [ ] Pick a real failure, find its root cause (systematic-debugging), fix it in the prompt or the gateway,
      re-run, and record before and after with the commit.
- [ ] Commit the final `eval/results/` and transcripts: `feat: eval results, 12 conversations x 3 runs`.

### Task 21: Customer note, questions, README and the docs audit

**Files:** `docs/customer-note.md`, `docs/questions.md`, `README.md`, `src/cli/jev.ts`, `src/cli/qa-docs.ts`

- [ ] `pnpm jev --file <path> --noul "<question>"` and `pnpm qa:docs` with the battery from spec 3.6.
- [ ] Write the three documents; run `qa:docs`; fix what it flags; re-run once.
- [ ] Commit `docs: customer note, questions, README`.

### Task 22: Review stack, verification and publish

- [ ] Review in five lenses over the whole diff: spec compliance, language bugs, security, performance,
      complexity. Fix findings.
- [ ] `pnpm check`, coverage, `pnpm audit --prod`, gitleaks, Playwright: all green, output kept.
- [ ] Create the public GitHub repo `paylane-support-agent`, push, confirm CI and Pages are green.
