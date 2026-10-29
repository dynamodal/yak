import { describe, expect, it } from 'vitest';
import { IDLE_THRESHOLD_MS, IdleTracker } from './idle';

const MIN = 60_000;

describe('IdleTracker', () => {
  it('reports nothing while ticks keep coming, even slowly (a hidden tab ticks about once a minute)', () => {
    const t = new IdleTracker(0);
    for (let m = 1; m <= 120; m++) expect(t.tick(m * MIN)).toBeNull();
  });

  it('reports nothing for a short gap', () => {
    const t = new IdleTracker(1000);
    expect(t.tick(1000 + 9 * MIN)).toBeNull();
  });

  it('reports the gap after more than ten minutes without a tick, once', () => {
    const t = new IdleTracker(0);
    const gap = t.tick(5000 + 10 * MIN + 1);
    expect(gap).toEqual({ since: 0, ms: 5000 + 10 * MIN + 1 });
    expect(t.tick(5000 + 10 * MIN + 2000)).toBeNull();
  });

  it('exactly the threshold is not idle', () => {
    const t = new IdleTracker(0);
    expect(t.tick(IDLE_THRESHOLD_MS)).toBeNull();
  });

  it('catches a sleep where the page stopped ticking', () => {
    const t = new IdleTracker(0);
    for (let s = 1; s <= 60; s++) expect(t.tick(s * 1000)).toBeNull();
    const gap = t.tick(60_000 + 3 * 3600_000);
    expect(gap?.since).toBe(60_000);
  });
});
