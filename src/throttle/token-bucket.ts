/**
 * Token-bucket throttle for Infomaniak's hard 60 req/min rate limit.
 *
 * Calls are queued in FIFO order and released as the bucket refills.
 * The bucket holds `capacity` tokens; one token is consumed per call.
 * Tokens older than 60 seconds are discarded automatically.
 */

export interface ThrottleOptions {
  /** Maximum requests allowed in the rolling window (Infomaniak: 60). */
  capacity: number;
  /** Window size in milliseconds (Infomaniak: 60_000). */
  windowMs: number;
}

export class TokenBucket {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly timestamps: number[] = [];
  private readonly waiters: Array<() => void> = [];

  constructor(options: ThrottleOptions) {
    if (options.capacity < 1) {
      throw new Error("TokenBucket capacity must be >= 1");
    }
    if (options.windowMs < 1) {
      throw new Error("TokenBucket windowMs must be >= 1");
    }
    this.capacity = options.capacity;
    this.windowMs = options.windowMs;
  }

  /**
   * Awaits permission to make one request.
   * Blocks until a token is available; never throws.
   */
  public async acquire(): Promise<void> {
    this.purge();
    if (this.timestamps.length < this.capacity) {
      this.timestamps.push(Date.now());
      return;
    }
    // Wait for the oldest timestamp to expire.
    return new Promise<void>((resolve) => {
      const tryAgain = (): void => {
        this.purge();
        if (this.timestamps.length < this.capacity) {
          this.timestamps.push(Date.now());
          resolve();
          return;
        }
        const oldest = this.timestamps[0] ?? Date.now();
        const waitMs = Math.max(50, oldest + this.windowMs - Date.now() + 10);
        setTimeout(tryAgain, waitMs);
      };
      this.waiters.push(tryAgain);
      tryAgain();
    });
  }

  /** Number of tokens currently available. */
  public available(): number {
    this.purge();
    return Math.max(0, this.capacity - this.timestamps.length);
  }

  /** Removes timestamps older than the rolling window. */
  private purge(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }
}

/** Default singleton throttle for Infomaniak's 60 req/min limit. */
export function createDefaultThrottle(capacity = 60): TokenBucket {
  return new TokenBucket({ capacity, windowMs: 60_000 });
}
