/**
 * Minimum spacing between requests per key, shared within this process. Used for the SEC
 * (well under its 10 requests per second) and for one request per domain per 10 seconds on
 * leadership pages (BRD 8.5). Each worker process keeps its own limiter; see DECISIONS.md.
 */
export class RateLimiter {
  private next = new Map<string, number>();

  constructor(
    private readonly intervalMs: number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Resolves when a request for `key` may go out, reserving the slot. */
  async wait(key: string): Promise<void> {
    const now = this.clock();
    const slot = Math.max(now, this.next.get(key) ?? 0);
    this.next.set(key, slot + this.intervalMs);
    if (slot > now) await this.sleep(slot - now);
  }
}
