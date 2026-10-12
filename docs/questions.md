# Questions for Fini, and what I assumed meanwhile

The brief is deliberately ambiguous in places. Each question says what I built while waiting, and where the
code would change if the answer differs. Every assumption is one constant or one rule.

| # | Question | What I assumed | Where it lives |
|---|---|---|---|
| 1 | `get_customer` always returns `verified: false`. Does "verified" mean the customer passed the chat check (last 4 + email), or a separate account-level flag? | The chat check, done in code: the model passes what the customer typed and gets back yes or no. It never sees the real digits or the email, so it can't leak them. | `src/agent/tools.ts` (get_customer) |
| 2 | Is the $75 limit on the transaction or on the refund? Can the agent refund $75 of a $120 charge? | The transaction, full refunds only. Anything over $75 goes to a person in full; no partial or split refunds. Exactly $75.00 is allowed ("up to"); exactly 30 days old is not ("under 30 days"). | `src/policy/refund-policy.ts` (`POLICY`, `decideRefund`) |
| 3 | Fraud under $500: refund it under the normal rules, or hand it off? Is $500 per charge or the total reported? | Every fraud report goes to a person, because a refund doesn't secure a stolen card. Over $500 in total is marked URGENT. | Rule R9; `signals.ts` fraud question |
| 4 | `get_customer` gives no freeze reason. General reasons only? Should a frozen account still get auto-refunds? | General reasons only, never a guessed specific one. No auto-refunds on a frozen account. | Rule R8; `decideRefund` |
| 5 | Can a pending charge be refunded? | No: the agent explains it settles or drops off, and offers a person. | Rule R7 |
| 6 | Is there a cap on refunds per customer (say five $70 refunds in a week)? | The policy has none, so none is enforced. Flagged as a launch risk. | `suggestedtask.md` |
| 7 | There's no "list transactions" call and customers rarely know an id. Can they see it in the app? | Yes: the agent asks for the id from the app's transaction details. | System prompt |
| 8 | Can `escalate_to_human` take no `customer_id` (an unverified person threatening legal action)? What can the agent say about response time? | Yes to the first; no timeframe is ever given. | `tools.ts` (escalate); Rule R12 |
| 9 | Once someone mentions a lawyer or closing the account, should the agent still issue an eligible refund in the same chat? | No: legal action, closure or fraud anywhere in a chat stops auto-refunds for that chat, and a person handles all of it. | Rule R9; sticky Jev flags |
| 10 | If a message tries to rewrite the agent's rules ("system override"), should refunds continue for that chat? | No: an override attempt stops auto-refunds for the chat. | Rule R10 |
