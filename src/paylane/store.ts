import type { Clock } from "../policy/clock.ts";
import type { CustomerFixture } from "./fixtures.ts";
import type { CustomerRecord, TransactionRecord } from "./types.ts";

export interface Store {
  customersByEmail: Map<string, CustomerRecord>;
  transactions: Map<string, TransactionRecord>;
  nextRefund: number;
  nextTicket: number;
}

const DAY_MS = 86_400_000;

function dateDaysAgo(today: string, days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** A fresh in-memory copy of the fixtures. Each chat or eval run gets its own, so nothing leaks between them. */
export function createStore(fixtures: readonly CustomerFixture[], clock: Clock): Store {
  const today = clock.today();
  const customersByEmail = new Map<string, CustomerRecord>();
  const transactions = new Map<string, TransactionRecord>();
  for (const f of fixtures) {
    customersByEmail.set(f.customer.email, { ...f.customer });
    for (const { daysAgo, ...txn } of f.transactions) {
      transactions.set(txn.id, { ...txn, customer_id: f.customer.id, date: dateDaysAgo(today, daysAgo) });
    }
  }
  return { customersByEmail, transactions, nextRefund: 1, nextTicket: 1 };
}
