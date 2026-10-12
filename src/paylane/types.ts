/** Shapes from the Paylane mock API spec: JSON in, JSON out. */

export type CustomerStatus = "active" | "frozen";
export type TxnStatus = "settled" | "pending" | "refunded";

export interface CustomerRecord {
  id: string;
  name: string;
  email: string;
  card_last4: string;
  status: CustomerStatus;
}

export interface TransactionRecord {
  id: string;
  customer_id: string;
  amount_cents: number;
  date: string;
  merchant: string;
  status: TxnStatus;
  refund_id?: string;
  /** Test-only fault injection: the processor rejects refunds on this transaction. */
  fault?: "processor_unavailable";
}

export type RefundFailure =
  "not_found" | "already_refunded" | "not_settled" | "invalid_amount" | "processor_unavailable";

export type GetCustomerResult =
  | { id: string; name: string; card_last4: string; status: CustomerStatus; verified: false }
  | { error: "not_found" };

export type GetTransactionResult =
  { amount: number; date: string; merchant: string; status: TxnStatus } | { error: "not_found" };

export type IssueRefundResult = { ok: true; refund_id: string } | { ok: false; reason: RefundFailure };

export interface PaylaneApi {
  get_customer(input: { email: string }): Promise<GetCustomerResult>;
  get_transaction(input: { customer_id: string; txn_id: string }): Promise<GetTransactionResult>;
  issue_refund(input: { txn_id: string; amount: number }): Promise<IssueRefundResult>;
  escalate_to_human(input: { customer_id: string | null; summary: string }): Promise<{ ticket_id: string }>;
}
