import { describe, expect, it, vi } from "vitest";

import { TokenBucket } from "../../src/throttle/token-bucket.js";

describe("TokenBucket", () => {
  it("rejects invalid configuration", () => {
    expect(() => new TokenBucket({ capacity: 0, windowMs: 60_000 })).toThrow();
    expect(() => new TokenBucket({ capacity: 60, windowMs: 0 })).toThrow();
  });

  it("acquires immediately while under capacity", async () => {
    const bucket = new TokenBucket({ capacity: 3, windowMs: 60_000 });
    const start = Date.now();
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    expect(Date.now() - start).toBeLessThan(50);
    expect(bucket.available()).toBe(0);
  });

  it("queues additional requests once the bucket is full", async () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket({ capacity: 2, windowMs: 1_000 });
    await bucket.acquire();
    await bucket.acquire();
    expect(bucket.available()).toBe(0);

    let resolved = false;
    const queued = bucket.acquire().then(() => {
      resolved = true;
    });

    // The queued promise should not resolve immediately.
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Advance past the rolling window.
    await vi.advanceTimersByTimeAsync(1_100);
    await queued;
    expect(resolved).toBe(true);

    vi.useRealTimers();
  });

  it("reports available tokens after timestamps expire", async () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket({ capacity: 2, windowMs: 1_000 });
    await bucket.acquire();
    expect(bucket.available()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(bucket.available()).toBe(2);
    vi.useRealTimers();
  });
});
