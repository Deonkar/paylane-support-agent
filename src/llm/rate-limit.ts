/**
 * A sliding-window limiter: at most `perMinute` acquisitions in any 60 seconds. Callers queue in order.
 * Needed because Gemini's free tier allows 15 requests per minute per model, and the SDK's short retries
 * cannot wait out a per-minute window.
 */
export function createRateLimiter(
  perMinute: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
): () => Promise<void> {
  const stamps: number[] = [];
  let queue: Promise<void> = Promise.resolve();
  return () => {
    const turn = queue.then(async () => {
      for (;;) {
        const t = now();
        while (stamps.length > 0 && t - (stamps[0] ?? 0) >= 60_000) stamps.shift();
        if (stamps.length < perMinute) {
          stamps.push(t);
          return;
        }
        await sleep(60_000 - (t - (stamps[0] ?? t)) + 50);
      }
    });
    queue = turn;
    return turn;
  };
}
