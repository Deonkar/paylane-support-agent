import { centsToDollars, parseDollars } from "../policy/money.ts";
import type { Store } from "./store.ts";
import type { PaylaneApi } from "./types.ts";

function seq(prefix: string, n: number): string {
  return `${prefix}_${String(n).padStart(4, "0")}`;
}

/**
 * The four Paylane endpoints exactly as specified. This layer knows nothing about the support policy (the $75
 * and 30-day rules), just as Paylane's real refund API would not; the agent's tool gateway enforces those.
 */
export function createPaylaneApi(store: Store): PaylaneApi {
  return {
    get_customer({ email }) {
      const customer = store.customersByEmail.get(email.trim().toLowerCase());
      if (!customer) return Promise.resolve({ error: "not_found" });
      const { id, name, card_last4, status } = customer;
      return Promise.resolve({ id, name, card_last4, status, verified: false });
    },

    get_transaction({ customer_id, txn_id }) {
      const txn = store.transactions.get(txn_id);
      // Another customer's transaction is reported exactly like a missing one, so existence never leaks.
      if (txn?.customer_id !== customer_id) return Promise.resolve({ error: "not_found" });
      return Promise.resolve({
        amount: centsToDollars(txn.amount_cents),
        date: txn.date,
        merchant: txn.merchant,
        status: txn.status,
      });
    },

    issue_refund({ txn_id, amount }) {
      // Check and set run in one synchronous block, so concurrent calls cannot both pass the check.
      const txn = store.transactions.get(txn_id);
      if (!txn) return Promise.resolve({ ok: false, reason: "not_found" });
      if (txn.status === "refunded") return Promise.resolve({ ok: false, reason: "already_refunded" });
      if (txn.status === "pending") return Promise.resolve({ ok: false, reason: "not_settled" });
      const parsed = parseDollars(amount);
      if (!parsed.ok || parsed.cents > txn.amount_cents) {
        return Promise.resolve({ ok: false, reason: "invalid_amount" });
      }
      if (txn.fault === "processor_unavailable") {
        return Promise.resolve({ ok: false, reason: "processor_unavailable" });
      }
      const refund_id = seq("rf", store.nextRefund++);
      txn.status = "refunded";
      txn.refund_id = refund_id;
      return Promise.resolve({ ok: true, refund_id });
    },

    escalate_to_human() {
      return Promise.resolve({ ticket_id: seq("tk", store.nextTicket++) });
    },
  };
}
