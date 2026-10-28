import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { durationOf, longestFirst, parseShard, shardOf } from './schedule.mjs';

const durations: Record<string, number> = { a: 50, b: 40, c: 30, d: 20, e: 10 };
const runs = ['a', 'b', 'c', 'd', 'e', 'new'].map((label) => ({ label }));

describe('e2e schedule', () => {
  it('orders longest first and puts an unknown run at the median', () => {
    expect(durationOf('new', durations)).toBe(30);
    expect(longestFirst(runs, durations).map((r) => r.label)).toEqual(['a', 'b', 'c', 'new', 'd', 'e']);
  });

  it('puts every run in exactly one shard, for any shard count', () => {
    for (let count = 1; count <= 4; count++) {
      const seen = Array.from({ length: count }, (_, i) => shardOf(runs, durations, i + 1, count).map((r) => r.label)).flat();
      expect(seen.sort()).toEqual(runs.map((r) => r.label).sort());
    }
  });

  it('balances the shards by duration', () => {
    const total = (i: number) => shardOf(runs, durations, i, 2).reduce((n, r) => n + durationOf(r.label, durations), 0);
    expect(Math.abs(total(1) - total(2))).toBeLessThanOrEqual(30);
  });

  it('is the same on every call', () => {
    expect(shardOf(runs, durations, 1, 2)).toEqual(shardOf([...runs], durations, 1, 2));
  });

  it('refuses a bad shard', () => {
    expect(() => parseShard('3/2')).toThrow();
    expect(() => parseShard('x')).toThrow();
    expect(parseShard('2/3')).toEqual({ index: 2, count: 3 });
  });

  it('keeps durations.json to existing suites', () => {
    const map = JSON.parse(readFileSync(new URL('./durations.json', import.meta.url), 'utf8')) as Record<string, number>;
    const suites = new Set(readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.mjs') && f !== 'schedule.mjs').map((f) => f.slice(0, -4)));
    for (const label of Object.keys(map)) expect(suites.has(label.replace(/ \(relay\)$/, '')), label).toBe(true);
  });
});
