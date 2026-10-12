# Suggested tasks

Things noticed and deliberately not done, with where they were found and what would close them.

| Finding                                                                                                      | Where                               | Why not now                                                           | Closes it                                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Verification lockout is per chat; an attacker can open a new chat and guess again                            | `src/agent/tools.ts` (get_customer) | Needs a server-side store keyed by email; the mock has no persistence | Per-email failure counter with a time window in Paylane's real verification endpoint; listed in the customer note |
| No per-customer refund cap (five $70 refunds in a week all pass)                                             | `src/policy/refund-policy.ts`       | The brief's policy has none; asked Fini (question 6)                  | A velocity rule in `decideRefund` once Paylane sets a number                                                      |
| Design finish review by a fresh reviewer agent was cut | `docs/plan.md` task 19 | Owner asked to ship fast; subagents only on request | Run the impeccable finish reviewer if the UI becomes a product surface |
