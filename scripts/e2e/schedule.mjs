// Queue order and shards for run.mjs (pure functions, unit-tested in schedule.test.ts).
//
// durations.json maps a run label to its seconds when it last ran alone in a normal CI job. Refresh it with
// `npm run e2e -- --write-durations` on a full run (docs/testing.md). A run with no entry counts as the median.

/** Seconds for a run label; the median of the known ones when the label is not in the map. */
export function durationOf(label, durations) {
  if (typeof durations[label] === 'number') return durations[label];
  const known = Object.values(durations).filter((n) => typeof n === 'number').sort((a, b) => a - b);
  return known.length ? known[Math.floor(known.length / 2)] : 1;
}

/** Longest first; equal durations keep their input order, so the order is the same on every machine. */
export function longestFirst(runs, durations) {
  return runs
    .map((run, i) => ({ run, i, d: durationOf(run.label, durations) }))
    .sort((x, y) => y.d - x.d || x.i - y.i)
    .map((x) => x.run);
}

/**
 * Shard `index` (1-based) of `count`: every run lands in exactly one shard. Longest runs are placed first, each in
 * the shard with the least total so far (ties: the lowest index), so the shards finish together.
 */
export function shardOf(runs, durations, index, count) {
  if (!Number.isInteger(count) || !Number.isInteger(index) || count < 1 || index < 1 || index > count) {
    throw new Error(`bad shard ${index}/${count}`);
  }
  const totals = Array.from({ length: count }, () => 0);
  const shards = Array.from({ length: count }, () => []);
  for (const run of longestFirst(runs, durations)) {
    const s = totals.indexOf(Math.min(...totals));
    shards[s].push(run);
    totals[s] += durationOf(run.label, durations);
  }
  return shards[index - 1];
}

/** `--shard 2/3` -> { index: 2, count: 3 }. */
export function parseShard(text) {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? '');
  if (!m) throw new Error(`--shard wants i/n, for example 1/2 (got ${text})`);
  const shard = { index: Number(m[1]), count: Number(m[2]) };
  shardOf([], {}, shard.index, shard.count);
  return shard;
}
