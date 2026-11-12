import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addSpace, readSpaces } from '../core/account';
import { decided, keeps } from '../core/keeps';
import { addPendingLocalSpaces } from './join';
import type { AccountState } from './account-state';
import type { StorageLike } from '../core/account-setup';

const PENDING = 'pending-local-spaces';
function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const stateOf = (doc: Y.Doc): AccountState => ({ doc, refresh: vi.fn(async () => undefined) }) as unknown as AccountState;

describe('addPendingLocalSpaces after a join', () => {
  it('names the device and keeps no account space', async () => {
    const doc = new Y.Doc();
    addSpace(doc, 'work', 'Work', undefined, 'laptop');
    const st = memory();
    st.setItem(`app-${PENDING}`, JSON.stringify({ spaces: [], name: 'Phone' }));
    const key = [...st.data.keys()][0] as string;
    await addPendingLocalSpaces(stateOf(doc), st, 'phone');
    expect(decided(doc, 'phone', 'work')).toBe(false);
    expect(keeps(doc, 'phone', 'work')).toBe(false);
    expect(JSON.parse(st.data.get(key) ?? '{}')).toEqual({});
  });

  it('ignores an old stored keepAccountSpaces flag (S-177)', async () => {
    const doc = new Y.Doc();
    addSpace(doc, 'work', 'Work', undefined, 'laptop');
    const st = memory();
    st.setItem(`app-${PENDING}`, JSON.stringify({ spaces: [], name: 'Phone', keepAccountSpaces: true }));
    await addPendingLocalSpaces(stateOf(doc), st, 'phone');
    expect(decided(doc, 'phone', 'work')).toBe(false);
  });

  it('adds the spaces the device brought, kept here, and leaves the account spaces undecided', async () => {
    const doc = new Y.Doc();
    addSpace(doc, 'work', 'Work', undefined, 'laptop');
    const st = memory();
    st.setItem(`app-${PENDING}`, JSON.stringify({ spaces: [{ id: 'mine', name: 'Mine' }] }));
    await addPendingLocalSpaces(stateOf(doc), st, 'phone');
    expect(readSpaces(doc).map((s) => s.id)).toContain('mine');
    expect(keeps(doc, 'phone', 'mine')).toBe(true);
    expect(decided(doc, 'phone', 'work')).toBe(false);
  });
});
