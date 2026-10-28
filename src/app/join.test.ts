import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addSpace, readSpaces } from '../core/account';
import { decided, keeps } from '../core/keeps';
import { addPendingLocalSpaces, keepsPendingApproval } from './join';
import type { AccountState } from './account-state';
import type { StorageLike } from '../core/account-setup';

const PENDING = 'pending-local-spaces';
function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const stateOf = (doc: Y.Doc): AccountState => ({ doc, refresh: vi.fn(async () => undefined) }) as unknown as AccountState;

describe('addPendingLocalSpaces after an approved join', () => {
  it('keeps the account spaces without asking, and names the device', async () => {
    const doc = new Y.Doc();
    addSpace(doc, 'work', 'Work', undefined, 'laptop');
    const st = memory();
    st.setItem(`app-${PENDING}`, JSON.stringify({ spaces: [], name: 'Firefox on Android', keepAccountSpaces: true }));
    const key = [...st.data.keys()][0] as string;
    await addPendingLocalSpaces(stateOf(doc), st, 'phone');
    expect(keeps(doc, 'phone', 'work')).toBe(true);
    expect(readSpaces(doc).map((s) => s.id)).toContain('work');
    expect(JSON.parse(st.data.get(key) ?? '{}')).toEqual({});
  });

  it('leaves spaces undecided when the join did not come from an approval', async () => {
    const doc = new Y.Doc();
    addSpace(doc, 'work', 'Work', undefined, 'laptop');
    const st = memory();
    st.setItem(`app-${PENDING}`, JSON.stringify({ spaces: [], name: 'Phone' }));
    await addPendingLocalSpaces(stateOf(doc), st, 'phone');
    expect(decided(doc, 'phone', 'work')).toBe(false);
  });
});

describe('keepsPendingApproval', () => {
  it('is true only while an approved join has spaces left to keep', async () => {
    const st = memory();
    expect(keepsPendingApproval(st)).toBe(false);
    st.setItem('app-pending-local-spaces', JSON.stringify({ spaces: [], name: 'Phone' }));
    expect(keepsPendingApproval(st)).toBe(false);
    st.setItem('app-pending-local-spaces', JSON.stringify({ spaces: [], keepAccountSpaces: true }));
    expect(keepsPendingApproval(st)).toBe(true);
    const doc = new Y.Doc();
    addSpace(doc, 'work', 'Work', undefined, 'laptop');
    await addPendingLocalSpaces(stateOf(doc), st, 'phone');
    expect(keepsPendingApproval(st)).toBe(false);
  });
});
