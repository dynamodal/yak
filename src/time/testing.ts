import { afterEach, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initSpaceDoc } from '../core/schema';
import type { TimeDocs } from './entries';

/** Test helper: fresh Personal and Work documents, as the app opens them. */
export function makeSpaceDocs(spaces: readonly string[] = ['personal', 'work']): Map<string, Y.Doc> {
  const docs = new Map<string, Y.Doc>();
  for (const id of spaces) {
    const doc = new Y.Doc();
    initSpaceDoc(doc);
    docs.set(id, doc);
  }
  return docs;
}

/** Test helper: sync two devices' documents in both directions, space by space. */
export function syncDevices(a: TimeDocs, b: TimeDocs): void {
  for (const [id, da] of a) {
    const db = b.get(id);
    if (!db) continue;
    Y.applyUpdate(db, Y.encodeStateAsUpdate(da, Y.encodeStateVector(db)), 'remote');
    Y.applyUpdate(da, Y.encodeStateAsUpdate(db, Y.encodeStateVector(da)), 'remote');
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number => new Date(y, mo - 1, d, h, mi, s).getTime();

/** Run the tests of a `describe` block in a given time zone, restoring the previous one afterwards. */
export function useTimeZone(tz: string): void {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.TZ;
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
}
