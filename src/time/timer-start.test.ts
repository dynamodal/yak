import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { startTimer, stopTimer } from './entries';
import { timerSpace } from './timer-start';

function docs(...ids: string[]): Map<string, Y.Doc> {
  return new Map(ids.map((id) => [id, new Y.Doc()]));
}

describe('timerSpace (T-62)', () => {
  it('falls back to the active space when there are no entries', () => {
    expect(timerSpace(docs('a', 'b'), 'b')).toBe('b');
  });

  it('is the space of the newest entry, not the active space', () => {
    const d = docs('a', 'b');
    const r1 = startTimer(d, 'a', 'dev', {}, 2_000);
    stopTimer(d.get('a') as Y.Doc, r1.id, 3_000);
    const r0 = startTimer(d, 'b', 'dev', {}, 1_000);
    stopTimer(d.get('b') as Y.Doc, r0.id, 1_500);
    expect(timerSpace(d, 'b')).toBe('a');
  });

  it('ignores a space that is not on this device', () => {
    const d = docs('a', 'b');
    const r = startTimer(d, 'a', 'dev', {}, 1_000);
    stopTimer(d.get('a') as Y.Doc, r.id, 2_000);
    d.delete('a');
    expect(timerSpace(d, 'b')).toBe('b');
  });
});
