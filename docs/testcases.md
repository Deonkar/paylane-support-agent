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
