# Note to Paylane's head of support

**Subject: Your support agent: what it does, what it won't, and what we need from you before launch**

Hi,

Here's where the support agent stands before next week.

**What it does**

- Checks who it's talking to first: the email on the account and the last 4 digits of the card. Until that
  matches, it won't discuss anything about the account.
- Looks up a charge and refunds it straight away when your policy allows: $75 or less, under 30 days old,
  no longer pending, and never refunded before. The customer gets a refund number.
- Explains a frozen card in general terms and hands it to your team.
- Hands everything else to a person with a short summary, so the customer doesn't have to repeat themselves:
  refunds over $75 or older than 30 days, fraud reports, legal threats and account closures.

**What it won't do**

- Refund anything outside the policy, even when a customer pushes, gets angry, asks for "just $75 of it", or
  asks for a charge to be split. This is built into the system, not just a rule the agent is asked to
  follow, so no message can talk it into a refund.
- Read out a card number or an email address, or say whether an email has an account.
- Act on someone else's account, whoever they say they are, including "I work at Paylane".
- Unfreeze cards, give legal opinions, or promise an outcome or a timeframe for a handed-off case.
- Keep a full card number. If a customer types one, it's removed before anything stores or reads it.

**How we tested it**

We wrote 12 test conversations, ordinary ones and tricky ones: an angry customer, someone posing as another customer's partner, a fake
"system message" trying to change its rules, a refund that fails at the bank, charges exactly at the $75 and 30-day limits. We ran each
one three times. In all 36 test runs it never issued a refund the policy did not allow, never leaked a card number or email, and never looked at an account before checking who it was talking to. Where it fell short was wording: it did not warn customers who pasted a full card number (now fixed), and its tone is correct but plain.

**What we need from you before launch**

1. Answers to a few policy gaps, listed in the attached questions. The main ones: should fraud under $500 still
   go to a person, and is there a limit on how many refunds one customer can get in a week?
2. Where handed-off chats should go on your side, and what customers should be told about how long a reply
   takes.
3. The reason a card was frozen, stored where the agent can see it, so it can say more than "usually a security
   precaution".
4. A limit on wrong guesses at a customer's card digits that lasts across chats. Ours resets with each new chat,
   so someone could start again and keep guessing.
5. Fifty or so real past conversations, with names and details removed, to test against before it goes live.
6. Someone on your team to read the first week of handed-off chats with us, so we can tune it quickly.

Happy to walk through any of it.
