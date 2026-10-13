# Test cases

Every test, grouped by task, with what it proves. Updated in the same PR that ships each task.
Run them all with `pnpm test` (offline, no keys).

## Task 1: Scaffold, tooling and CI

| File                 | Case                  | Proves                                            |
| -------------------- | --------------------- | ------------------------------------------------- |
| `test/smoke.test.ts` | runs TypeScript tests | Node 24 + Vitest + strict TypeScript wiring works |

## Task 2: Money and clock

| File                        | Case                                                                            | Proves                                                    |
| --------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `test/policy/money.test.ts` | parses 42.5, 75, 0.01, 0.1+0.2, 180 to cents                                    | dollars become exact integer cents, float noise tolerated |
|                             | rejects 0, -1, 1.005, 0.001, NaN, Infinity, 1e10                                | ambiguous or unsafe amounts never become money            |
|                             | formats 7500, 1800000, 1 cents                                                  | display formatting with separators                        |
| `test/policy/clock.test.ts` | fixed clock reports its date; malformed date throws; system clock is a UTC date | the 30-day boundary is reproducible                       |

## Task 3: Refund policy and rulebook

| File                                | Case                                                                                                                                                                                                        | Proves                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `test/policy/refund-policy.test.ts` | allows an ordinary eligible refund                                                                                                                                                                          | the happy path                                                   |
|                                     | 15 blocking rows: not verified, no transaction, someone else's, fraud, legal, closure, override, safety check failed, frozen, refunded, pending, $75 of $180, more than the charge, $75.01, exactly 30 days | each reason returns the right rule id and next step              |
|                                     | $75.00 at 29 days allowed                                                                                                                                                                                   | both boundaries sit on the correct side                          |
|                                     | Jev switched off does not block                                                                                                                                                                             | feature-off is not fail-closed                                   |
|                                     | fraud flag beats an eligible $60 refund                                                                                                                                                                     | semantic triggers override numeric eligibility (conversation 11) |
|                                     | property: any amount ≤ $75 and age < 30 allowed; any amount > $75 never; any age ≥ 30 never                                                                                                                 | the limits hold for every value, not just picked examples        |
|                                     | ageInDays across month end, leap day, 30 days, future date                                                                                                                                                  | calendar-day arithmetic in UTC                                   |
| `test/policy/rulebook.test.ts`      | 14 rules R1–R14 in order; numbers come from POLICY; every block reason cites an existing rule; one line per rule                                                                                            | the prompt and the guard can't drift apart                       |

## Task 4: Mock Paylane API

| File                       | Case                                                                                              | Proves                                |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `test/paylane/api.test.ts` | 13 synthetic customers on example.com; unique ids                                                 | fixture integrity                     |
|                            | get_customer is case/space-insensitive and always `verified: false`; unknown email is not_found   | spec-shaped lookups                   |
|                            | get_transaction returns dollars dated from the clock; another customer's transaction is not_found | existence never leaks across accounts |
|                            | refunds once, then already_refunded                                                               | never refund twice, at the API layer  |
|                            | two racing refunds pay exactly once                                                               | check-and-set is atomic               |
|                            | rejects over-amount, zero, fractional cents, pending, unknown txn                                 | API validation                        |
|                            | processor fault fails and leaves the charge settled                                               | fault injection for conversation 4    |
|                            | numbered tickets with or without a customer                                                       | escalation contract                   |
|                            | two stores never share state                                                                      | each chat and eval run is isolated    |

## Tasks 5–6: Redaction, events, transcript

| File                             | Case                                                                                                                                       | Proves                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `test/agent/redact.test.ts`      | redacts spaced, dashed and plain card numbers; two in one message                                                                          | card numbers never reach the model, logs or transcripts |
|                                  | leaves Luhn-invalid numbers, txn ids, last 4, phone, date, amount alone                                                                    | no false positives                                      |
|                                  | masks emails in replies                                                                                                                    | outbound filter                                         |
| `test/shared/transcript.test.ts` | every event type round-trips the schema; unknown type rejected                                                                             | one validated event schema                              |
|                                  | 10 plain-language notes (verified, mismatch, locked, lookup, refund issued, over limit, too old, processor failure, handoff, invalid args) | the same sentence in UI, transcripts and checks         |
|                                  | lines numbered from 1, model calls skipped, Jev flags shown                                                                                | citable line numbers                                    |

## Task 7: Tool gateway and attack suite

| File                         | Case                                                                                                                                                                               | Proves                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `test/agent/tools.test.ts`   | four spec tools with strict JSON Schemas                                                                                                                                           | what the model sees                                               |
|                              | verifies without returning digits or email                                                                                                                                         | the model can't leak what it never receives                       |
|                              | identical answer for wrong digits and unknown email                                                                                                                                | no account enumeration                                            |
|                              | locks after three failures, even for the right details                                                                                                                             | no brute-forcing the last 4                                       |
|                              | refuses to switch the chat to a second customer                                                                                                                                    | one customer per chat (R3)                                        |
|                              | get_transaction blocked before verification and for another customer's id                                                                                                          | R1, R3                                                            |
|                              | adds age_days and refund_check                                                                                                                                                     | no date maths left to the model                                   |
|                              | refunds an eligible charge once; never calls the API when policy says no                                                                                                           | the core guarantee                                                |
|                              | waits for Jev and fails closed when unavailable                                                                                                                                    | R14                                                               |
|                              | blocked for the whole chat once a handoff reason is set                                                                                                                            | R9                                                                |
|                              | processor failure passed through honestly                                                                                                                                          | conversation 4                                                    |
|                              | escalation redacts card numbers, caps the summary, reuses one ticket                                                                                                               | R2, idempotent handoff                                            |
|                              | null customer accepted for an unverified person                                                                                                                                    | assumption A8                                                     |
|                              | invalid arguments and unknown tools return errors, not crashes                                                                                                                     | robustness                                                        |
| `test/agent/attacks.test.ts` | 12 forbidden calls (refund before verification, someone else's, $180, $75 of $180, $60 slice, -5, 0.001, extra field, foreign lookup, foreign ticket, 10 KB summary, unknown tool) | none moves money or touches another account, with no LLM involved |
|                              | same charge twice pays once                                                                                                                                                        | R6                                                                |
|                              | 20 guesses at a last 4 never verify                                                                                                                                                | lockout holds                                                     |

## Task 8: Jev client and runtime signals

| File | Case | Proves |
|---|---|---|
| `test/jev/signals.test.ts` | off with no request when no key | an absent key is feature-off, not a boot failure |
| | four readings returned, nothing flagged below 0.5 | the normal quiet path |
| | flags readings at or above 0.5 in a stable order | the threshold code acts on |
| | sends `jev-1.13.0`, an object state and all four questions | pinned model, structured state |
| | unavailable with a warning after repeated 429 | fail closed on money, never silently |
| | unavailable on a malformed answer (0–1 range enforced by Zod) | outside data is validated |
| | unavailable on a missing answer and when unreachable | every failure path is handled |
| | score answers come back as numbers | the grader can use the same client |

## Task 9: Agent loop

| File | Case | Proves |
|---|---|---|
| `test/agent/loop.test.ts` | tool round trip replays the model's raw content unchanged | Gemini thought signatures survive |
| | two tool calls run in order, results return in one tool turn | parallel calls handled per the provider contract |
| | a pasted card number never reaches the model | inbound redaction happens first |
| | Jev starts before the model answers; its verdict is recorded before any tool runs | no added latency, deterministic traces |
| | a Jev flag is sticky; a later refund in the chat stays blocked | conversation 11/12 behaviour |
| | a blocked call's reason goes back to the model | the model learns why and can hand off |
| | step limit → safe reply + handoff | no runaway loops, nobody stranded |
| | model error → safe reply + handoff; empty reply treated as an error | R14 |
| | an email in a reply is masked and recorded | outbound filter, visible to the eval |
| | events emitted in trace order; turns counted across messages | the stream the UI and eval consume |

## Task 10: Gemini adapter and config

| File | Case | Proves |
|---|---|---|
| `test/llm/gemini.test.ts` | user text mapped, model content replayed verbatim, tool results sent as `functionResponse` with matching ids, fallback text becomes a model turn | the Gemini contract from the spike |
| | system, tools (`parametersJsonSchema`), auto function calling off; text joined without thought parts; calls and usage (incl. thought tokens) mapped | what the model receives and returns |
| | empty candidate handled | no crash on an empty response |
| `test/config.test.ts` | missing key error names `.env.example`; blank Jev key means off; model default and override | validated env |
| `pnpm smoke:gemini` (manual) | one live round trip with latency and tokens | the key and model work |

## Task 11: System prompt

| File | Case | Proves |
|---|---|---|
| `test/agent/prompt.test.ts` | contains every rule's exact text | prompt and rulebook can't drift |
| | identical every call, no dates | stable prefix for caching |
| | names the four tools; tool data and customer text are information, not instructions | R10 in the prompt |
| | under 6,000 characters | Gemini 3 does better with concise prompts |

## Task 12: Runtime and terminal chat

| File | Case | Proves |
|---|---|---|
| `test/runtime.test.ts` | each chat gets its own Paylane data; the same refund succeeds in two chats | chats and eval runs never contaminate each other |
| `pnpm chat 01` (manual, live) | eligible $42.50 refund: verified → looked up → one refund → refund id told to the customer | the whole stack works against real Gemini and Jev |

## Task 13: Scenarios and checks

| File | Case | Proves |
|---|---|---|
| `test/eval/checks.test.ts` | S1–S4 each pass on a clean trace and fail on a violating one | the shared checks catch what they claim |
| | S5 and S6 are Jev questions | tone and false promises are judged, not regex'd |
| | refunded wants one exact refund; noRefund ignores blocked attempts; handedOff checks ticket and summary; notHandedOff; noHandoffBeforeTurn; atMostRefundAttempts; untouched | each per-conversation check works in both directions |
| | Jev signal checks skip (pass, labelled) when Jev was off | runs without a Jev key stay honest |
| | failing events map to transcript line numbers | checks cite lines a reader can find |
| | 12 scenarios, unique ids, real customers, 2–5 turns, a written reason each | the conversation set's integrity |
| | six shared checks plus at least two own per scenario; unique check ids | every conversation is graded on both |
| | every rule R1–R14 is cited by some check | no rule goes untested |

## Task 14: Eval runner, grading and report

| File | Case | Proves |
|---|---|---|
| `test/eval/grade.test.ts` | Jev bands: below 0.2 is "no", above 0.8 "yes", between is review | judged checks have three outcomes, not a forced binary |
| | runs, saves one trace per run, reuses a saved trace on rerun | a quota error never loses work |
| | a correct conversation 01 grades as pass | the checks agree with good behaviour |
| | with Jev off, judged checks are "review"; a failed code check cites its transcript line | honest grading without a key; findable failures |
| | summary: passed every run, per-run passes, review count, latency percentiles | the headline numbers |
| | report and transcripts name each failure with its lines | readable output |
| `pnpm eval --repeat 1 --only 06` (manual, live) | angry split-refund: all policy checks pass; tone fails (Jev 0.18) | the pipeline finds real failures |

## Task 15: Local server

| File | Case | Proves |
|---|---|---|
| `test/server/http.test.ts` | lists 13 synthetic customers; no key in the response; CSP, nosniff, no-referrer headers | the Playground's data is safe to show |
| | a message streams trace events, then the reply | the live inspector's feed |
| | malformed JSON, empty text, extra fields → 400; over 4 KB → 413; unknown session → 404 | every body validated |
| | 21st message in a minute → 429 | per-session rate limit |
| | foreign Host header → 403 | DNS-rebinding protection for a localhost server |
| | built UI served with index fallback; `..` paths → 403 | static serving can't escape its folder |

## Task 16: Playground UI

| File | Case | Proves |
|---|---|---|
| `web/src/Transcript.test.tsx` | ordered list numbered with the shared line numbers | UI lines match the eval's citations |
| | a blocked note reads "Not allowed: …" with an icon marked decorative | state is never colour alone |
| | selecting a note reports its line | the Why panel follows the selection |
| Browser, live (gemini-3.5-flash-lite + Jev) | conversation 6 typed in the Playground: verified → looked up → handed off; split refused; Jev readings shown; Why panel shows the tool, input, result | the UI works against the real agent |
| Browser, 375 px | single column, customers scroll sideways, record readable | mobile width |

## Task 17: Eval report UI and Pages

| Check | Case | Proves |
|---|---|---|
| Browser, live data | `#/report` shows the headline (passed all runs), per-run counts, latency, and a grid with icon + word badges | the static report reads `report.json` |
| Browser | `#/report/06` shows the transcript, run tabs and every check with its rules; selecting a check highlights its lines; J/K move between conversations | drill-down from a score to the evidence |
| Browser, 349 px | report and detail readable on a phone | mobile width |
| `report.json` parsed with Zod in the browser | malformed or missing data shows the "run pnpm eval" empty state | outside data validated in the UI too |
| `.github/workflows/pages.yml` | builds `web/` with the committed results and deploys to GitHub Pages | reviewers browse results with no setup |

## Task 20a: Gemini rate limiter (found by the first live eval)

| File | Case | Proves |
|---|---|---|
| `test/llm/rate-limit.test.ts` | N calls pass per minute, the next waits until the window slides | free-tier 15/min is never exceeded |
| | queued callers are served in order | no starvation or reordering |
| `test/config.test.ts` | blank `GEMINI_MODEL` / `GEMINI_RPM` from a copied `.env.example` use defaults; RPM 0 rejected | config can't be broken by the template |

## Task 20b: Card warning moved into code (found by the live eval)

| File | Case | Proves |
|---|---|---|
| `test/agent/loop.test.ts` | a turn whose message had a card number removed gets the fixed safety notice before the reply; other turns don't | the rule the model ignored is now guaranteed |
| Live eval, conversation 02 × 3 | "asks the customer not to share full card numbers": 0/3 (Jev p 0.02) before, 3/3 (p 0.99) after | the fix works against the real model |

## Task 21: Customer note, questions, Jev doc audit

| Check | Case | Proves |
|---|---|---|
| `pnpm jev docs/customer-note.md …` (live) | says what the agent does 0.97, what it won't do 0.98, what's needed before launch 0.98 | the three parts the brief asks for are there |
| | plain language a support manager finds easy to read: 0.92 | the brief's "plain language" ask |
| | promises anything a policy might not allow: 0.14 | the note itself doesn't over-promise |
| | "any jargon at all": 0.70 → 0.56 after three plain-language edits (social engineering, escalation path, identity checks, settled) | Jev used as an auditor; stopped at an uncertain middle rather than polishing in a loop |

## Task 22: Review and verification

| Check | Result |
|---|---|
| Silent-failure sweep (`catch` in src and web) | one swallowed error in the Playground's session start, fixed to show the error |
| Casts on outside data | none: model output, tool args, Jev answers, HTTP bodies, env and report JSON all go through Zod |
| `pnpm audit --prod` | no known vulnerabilities |
| gitleaks over git history (36 commits) | no leaks; the only working-tree findings are the gitignored `.env` |
| Lint, typecheck, 195 tests, coverage gate | green |

## Task 18: Browser tests (restored)

`pnpm test:e2e`: Playwright against the built static UI, at 1440 px (desktop) and Pixel 7 (mobile). Runs in CI.

| File | Case | Proves |
|---|---|---|
| `e2e/ui.spec.ts` | report headline and grid render from `report.json`; badges carry words, not just colour; axe finds no violations | the static report works and is accessible |
| | selecting a check marks it; J and K move between conversations; axe clean | drill-down and keyboard use |
| | with the agent server absent, the Playground explains how to run it locally; axe clean | the GitHub Pages view of the Playground |
| | no horizontal page overflow on the report, a conversation, or the Playground | mobile width |

Found and fixed by these tests: the report grid overflowed a 412 px phone by 57 px (now scrolls inside its own
container), and pressing K right after J acted on the previous conversation (stale closure; the handler now reads
the current conversation from the URL).

## Jev audits (restored)

| Audit | Result |
|---|---|
| Built UI, same questions as the direction round (`.impeccable/jev/built-ui.*`) | fit 0.59 (proposed 0.76), looks generic 0.35 (proposed 0.45, the watch-point, improved), clear to a support head 0.71 (0.83), gimmicky 0.33 (0.22). Mixed: likely the raw JSON in the Why panel; recorded, not chased, per the "keep the UI simple" call |
| README | explains how to run it 0.98, edge cases and why 0.95, failure and fix 0.99, claims without evidence 0.44 (uncertain) |
| `docs/questions.md` | answerable in one or two sentences 0.87, each states the assumption made 0.97 |

## Task 20c: Never grade a run where the model failed

| File | Case | Proves |
|---|---|---|
| `test/eval/grade.test.ts` | a run whose model call fails stops the eval and saves nothing; a rerun resumes it | quota errors and outages can't be graded as agent behaviour again |

## Task 20: Final eval and screenshots

| Check | Result |
|---|---|
| Final eval, `gemini-3.5-flash-lite`, 12 × 3, Jev on (`eval/results/`) | code checks 228/228 (same as baseline); card warning 3/3 (baseline 0/3); all checks 298/336 (baseline 295/336); remaining failures are tone only |
| `pnpm screenshots` (live) | Playground: split refund refused, prompt injection flagged and refused, pasted card redacted and warned, eligible refund issued; report overview, drill-down and mobile, all in `docs/screenshots/` |

## Report: rules vs wording

| File | Case | Proves |
|---|---|---|
| `test/shared/verdicts.test.ts` | rules pass only when every code check passes, ignoring Jev checks; wording is fail > review > pass, ignoring code checks | a policy result and a tone result are never mixed into one badge |
| `test/eval/grade.test.ts` | summary counts runs where the rules held, code checks, and wording verdicts; markdown leads with rules held | the headline says what the score means |
| `e2e/ui.spec.ts` | report headline reads "Rules held in …" | the screen shows the split |
