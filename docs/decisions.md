# Decisions

Short records of choices that shape the code. Newest last.

## D1. The model talks, Jev judges, the code decides

Every rule code can check is enforced at the tool boundary before the mock API is touched; semantic triggers
(fraud, legal, closure, override) come from Jev's calibrated probabilities and code acts on them; Gemini only
converses and picks tools. A prompt-only agent relies on the model never slipping; this one makes a slip
harmless and still counts it as a failure in the eval.

## D2. `get_customer` takes the digits the customer typed

The spec's `get_customer(email)` would hand the model the real last 4 digits, the verification secret. The
gateway compares in code (constant time) and returns only yes or no, identical for an unknown email and a
wrong digit, and locks after three failures. The four spec functions exist unchanged underneath.

## D3. Gemini free tier, `gemini-3.5-flash-lite`

Chosen for $0 cost. `gemini-3.8-flash` returned 503/504 under load on 2026-10-12; flash-lite answered in about
1.4 s. `GEMINI_MODEL` switches it. Temperature stays at Google's recommended 1.0, so every conversation runs
three times and the headline is "passed every run".

## D4. Jev in three roles, optional

Runtime triggers, eval grader (with a "needs review" band between 0.2 and 0.8), and auditor. Pinned to
`jev-1.13.0`. Without a key the feature is off and judged checks report "review", never a fake pass. If Jev is
configured but fails, refunds pause for that turn (fail closed on money).

## D5. Rate limiter in the Gemini adapter

Cut at first as unnecessary; restored after the first live eval hit the free tier's 15 requests per minute and a
third of runs fell back to a handoff. Sliding window, `GEMINI_RPM`, default 14.

## D6. Card warning in code, not in the prompt

The prompt told the model to ask customers not to share full card numbers; it ignored that in 3 of 3 runs of
conversation 2. Whenever a turn's inbound message had a card number removed, the loop now prefixes the reply
with a fixed notice. Rules a model keeps missing move into code.

## D7. Simple UI, no router or component library

React + Vite, plain CSS, hash routes so the static report works on GitHub Pages. The owner asked to ship the
backend properly and keep the frontend simple; the design finish review, Playwright suite and docs-audit
battery were cut (see `suggestedtask.md`).
