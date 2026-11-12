import { describe, expect, it, vi } from 'vitest';
import { KeyTrust } from '../../src/app/key-trust';
import { PluginKeys, type KeyData } from './plugin-keys';

function vault(data: KeyData, doc?: unknown) {
  const calls: string[] = [];
  const sync = { join: vi.fn(async () => void calls.push('join')) };
  const pk = new PluginKeys({ me: 'me', data, trust: new KeyTrust(), sync, save: async () => {}, onChange: () => {} } as never);
  Object.assign(pk, {
    doc,
    ready: Promise.resolve(),
    dropKeys: async () => void calls.push('drop'),
    ask: async () => void calls.push('ask'),
  });
  return { pk, calls };
}

describe('a vault joining with a code (#168)', () => {
  it('makes new keys before asking when no account document is open yet (just started)', async () => {
    const { pk, calls } = vault({});
    await pk.joinWithCode('code', 'wss://relay', 'name');
    expect(calls).toEqual(['drop', 'join', 'ask']);
  });
  it('makes new keys when it knew it was removed, and clears the flag', async () => {
    const data: KeyData = { removed: true };
    const { pk, calls } = vault(data);
    await pk.joinWithCode('code', 'wss://relay', 'name');
    expect(calls).toEqual(['drop', 'join', 'ask']);
    expect(data.removed).toBeUndefined();
  });
});
