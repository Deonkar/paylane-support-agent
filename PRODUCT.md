# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + Vite (user's choice). A small local Node server hosts the agent and holds the API keys; the browser
never sees a key. The eval report also builds to static files for GitHub Pages.

## Users

- **Fini reviewers**: engineers who build AI support agents for customers. They skim the eval score, open a
  failing check, read the transcript behind it, and try their own attacks in the Playground. They are
  evaluating a candidate between other work, so the first minute decides what they think.
- **Paylane's head of support** (the persona the customer note is written to): not technical. Needs to see,
  in plain words, what the agent does, what it refuses, and when it hands a customer to a person.
- **The candidate**, demoing it live in an interview and typing attacks in front of the interviewer.

## Product Purpose

A take-home submission for Fini: a support agent for Paylane (a fictional fintech app for cards, transfers and
refunds) that follows a written policy under pressure. Two screens make it inspectable:

- **Playground**: chat with the agent as any of 12 test customers while every decision behind each reply is
  shown next to it.
- **Eval report**: how the agent scored on 12 scripted conversations, each run three times, with every check
  and transcript one click away.

Success: within a minute, a reviewer understands the score and watches the agent hold a rule, such as refusing
to split a $180 refund into three $60 ones, and can see exactly why it refused.

## Positioning

"The model talks, Jev judges, the code decides." A generic chat demo shows messages. This shows the trail
behind them: which tools ran, which policy checks allowed or blocked an action and under which rule, and what
Jev's calibrated probabilities said about fraud, legal threats, account closure or attempts to override the
rules.

## Operating Context

- Reviewers arrive from the GitHub README, open the public eval report, and drill into a conversation.
  Some clone the repo and run the Playground locally with a free Gemini key.
- In the interview the Playground is screen-shared while the candidate types attacks live.
- Desktop first (laptops); the report link must still work on a phone.

## Capabilities and Constraints

- 12 synthetic customers (example.com emails, last 4 card digits, transactions with amounts, dates, merchants
  and statuses), each tied to one scripted conversation.
- Live agent events: customer message, card number redacted, Jev signals (four probabilities), tool calls with
  arguments and results, policy decisions (allowed, or blocked with reason and rule id), refunds, handoff
  tickets, masked output.
- Eval data: 12 conversations × 3 runs; each check is pass, fail or needs review; checks are deterministic or
  Jev-graded; latency and tokens per conversation.
- Terms used throughout: "hand off" (to a person), "refund", "verified", rule ids R1 to R14, shared checks S1
  to S6 plus per-conversation checks.
- API keys never reach the browser. The Playground runs only on the local machine.

## Brand Commitments

None. Paylane is a fictional brand from the brief, with no logo or palette. Do not imitate Fini's branding or
any real company's.

## Evidence on Hand

- The policy brief, mock API spec and design: `docs/spec.md`.
- Eval results and transcripts do not exist yet. They must come from real runs and are never invented.
- Customer fixtures are synthetic and labelled as such wherever shown.

## Product Principles

1. Show why, not just what: every action traces to a rule, a judgment or a tool result.
2. Plain words first, technical detail one click away, so a support manager and an engineer can both read it.
3. Honest results: failures and "needs review" are as visible as passes.
4. Safety is visible: blocked attempts and masked data are highlighted, never hidden.

## Accessibility & Inclusion

WCAG 2.2 AA: contrast, full keyboard use, new chat messages announced to screen readers, pass and fail never
conveyed by colour alone, reduced motion respected.
