/** Money is integer cents everywhere inside the app. Dollars exist only in API JSON and display text. */

const MAX_CENTS = 100_000_000_000; // $1bn: far above any card transaction, far below float precision limits

export type AmountParse =
  | { ok: true; cents: number }
  | { ok: false; reason: "not_a_number" | "not_positive" | "fractional_cents" | "too_large" };

/** Converts a dollar amount (as a model or an API sends it) to cents, refusing anything ambiguous. */
export function parseDollars(amount: number): AmountParse {
  if (!Number.isFinite(amount)) return { ok: false, reason: "not_a_number" };
  if (amount <= 0) return { ok: false, reason: "not_positive" };
  const cents = Math.round(amount * 100);
  if (cents > MAX_CENTS) return { ok: false, reason: "too_large" };
  // Float noise (0.1 + 0.2) is tolerated; a genuine third decimal (1.005) is not.
  if (Math.abs(amount * 100 - cents) > 1e-6) return { ok: false, reason: "fractional_cents" };
  return { ok: true, cents };
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(cents: number): string {
  return usd.format(cents / 100);
}
