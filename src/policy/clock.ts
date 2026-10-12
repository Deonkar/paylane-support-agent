/** Time is injected so the 30-day boundary is reproducible in tests and evals. */
export interface Clock {
  /** Today's calendar date in UTC, as YYYY-MM-DD. */
  today(): string;
  nowMs(): number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function fixedClock(isoDate: string): Clock {
  if (!ISO_DATE.test(isoDate) || Number.isNaN(Date.parse(isoDate))) {
    throw new Error(`fixedClock expects a YYYY-MM-DD date, got "${isoDate}"`);
  }
  const noon = Date.parse(`${isoDate}T12:00:00Z`);
  return { today: () => isoDate, nowMs: () => noon };
}

export const systemClock: Clock = {
  today: () => new Date().toISOString().slice(0, 10),
  nowMs: () => Date.now(),
};
