import { describe, expect, it } from 'vitest';
import { parseRelayRefusal, RELAY_CLOSE_DAY, RELAY_CLOSE_RATE } from './relay-refusal';

describe('parseRelayRefusal', () => {
  it('reads a per-minute refusal and its retry time', () => {
    expect(parseRelayRefusal(RELAY_CLOSE_RATE, 'rate retry=60')).toEqual({ kind: 'rate', retryMs: 60_000 });
  });
  it('reads a daily refusal, its scope and when the day resets', () => {
    const now = Date.UTC(2026, 9, 29, 22, 0, 0);
    const reset = Math.floor(Date.UTC(2026, 9, 30) / 1000);
    expect(parseRelayRefusal(RELAY_CLOSE_DAY, `day scope=topics reset=${reset}`, now)).toEqual({ kind: 'day', scope: 'topics', retryMs: 30 * 60_000, resetsAt: reset });
    expect(parseRelayRefusal(RELAY_CLOSE_DAY, `day scope=share reset=${Math.floor(now / 1000) + 20}`, now)).toMatchObject({ kind: 'day', scope: 'share', retryMs: 20_000 });
  });
  it('keeps a sane pause when the reason is missing or odd', () => {
    expect(parseRelayRefusal(RELAY_CLOSE_RATE, '')).toEqual({ kind: 'rate', retryMs: 60_000 });
    expect(parseRelayRefusal(RELAY_CLOSE_RATE, 'rate retry=0.001')?.retryMs).toBe(5000);
    expect(parseRelayRefusal(RELAY_CLOSE_RATE, 'rate retry=99999')?.retryMs).toBe(30 * 60_000);
    expect(parseRelayRefusal(RELAY_CLOSE_DAY, 'day')).toMatchObject({ kind: 'day', scope: 'share', retryMs: 30 * 60_000 });
  });
  it('treats every other close as a plain drop', () => {
    for (const code of [1000, 1001, 1005, 1006, 1008, 1011, 4000, 4428, 4431]) expect(parseRelayRefusal(code, 'rate retry=60')).toBeUndefined();
  });
});
