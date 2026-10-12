import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../../src/llm/rate-limit.ts";

describe("rate limiter", () => {
  it("lets N calls through per minute, then waits for the window to slide", async () => {
    let clock = 0;
    const waits: number[] = [];
    const acquire = createRateLimiter(
      2,
      () => clock,
      (ms) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    );
    await acquire();
    clock += 10_000;
    await acquire();
    expect(waits).toEqual([]);
    await acquire(); // third call must wait until the first leaves the window
    expect(waits).toEqual([50_050]);
    expect(clock).toBe(60_050);
  });

  it("serves queued callers in order", async () => {
    let clock = 0;
    const acquire = createRateLimiter(
      1,
      () => clock,
      (ms) => {
        clock += ms;
        return Promise.resolve();
      },
    );
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => acquire().then(() => order.push(n))));
    expect(order).toEqual([1, 2, 3]);
  });
});
