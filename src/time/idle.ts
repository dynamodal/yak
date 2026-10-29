/**
 * Detects that the user was away: the device slept or the page stopped ticking for longer than a
 * threshold. Merely being hidden is not away (a background tab with a timer running is normal; the
 * page keeps ticking, slowly). Pure logic; the caller feeds it ticks with timestamps.
 */
export const IDLE_THRESHOLD_MS = 10 * 60 * 1000;

export interface IdleGap {
  /** When the page was last seen active; the idle time starts here. */
  since: number;
  /** How long the page was away. */
  ms: number;
}

export class IdleTracker {
  private lastSeen: number;

  constructor(
    now: number,
    private readonly thresholdMs: number = IDLE_THRESHOLD_MS,
  ) {
    this.lastSeen = now;
  }

  /** Call about once a second, hidden or not (a hidden tab ticks about once a minute). A gap over the threshold means the page was not running. */
  tick(now: number): IdleGap | null {
    return this.seen(now);
  }

  private seen(now: number): IdleGap | null {
    const ms = now - this.lastSeen;
    const gap = ms > this.thresholdMs ? { since: this.lastSeen, ms } : null;
    this.lastSeen = now;
    return gap;
  }
}
