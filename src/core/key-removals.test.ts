import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { keysMap, publishAccountKey, publishDeviceKeys, readAccountKeys, readDeviceKey } from './account-keys';
import { readCerts, requireKeys, certifyDevice } from './key-certs';
import { isKeyRemoved, readRemovals, removalTag, removeDevices } from './key-removals';
import { maintainGrants, readGrants } from './key-grants';
import { isRemoved, setRemoved } from './devices';
import { setKeeps } from './keeps';
import { fingerprint, generateAccountKey, generateDeviceKeys, type DeviceKeyPairs } from './keys';

/** A keys-required account with approved devices that all keep space s1, which has its key. */
async function account(ids: string[]) {
  const doc = new Y.Doc();
  const acc = await generateAccountKey();
  const fp = await fingerprint(acc.publicKey);
  publishAccountKey(doc, fp, acc.publicKey, ids[0] as string, 0);
  const devices = new Map<string, DeviceKeyPairs>();
  for (const id of ids) {
    const d = await generateDeviceKeys();
    devices.set(id, d);
    publishDeviceKeys(doc, id, d.publicKeys);
    setKeeps(doc, id, 's1', true);
  }
  await requireKeys(doc, fp, acc.privateKey, ids.map((id) => readDeviceKey(doc, id)!), ids[0] as string);
  return { doc, fp, acc, devices };
}

type Acc = Awaited<ReturnType<typeof account>>;

async function trust(s: Acc) {
  const accounts = await readAccountKeys(s.doc);
  const removals = await readRemovals(s.doc, accounts.find((a) => a.fingerprint === s.fp));
  const certs = await readCerts(s.doc, s.fp, accounts, true, new Set(removals.map(removalTag)));
  return { removals, certs, grants: await readGrants(s.doc, s.fp, certs, accounts) };
}

async function remove(s: Acc, ...ids: string[]) {
  const t = await trust(s);
  await removeDevices(s.doc, s.fp, s.acc.privateKey, ids.map((id) => t.certs.get(id)!));
}

describe('removing a device (#258, #295)', () => {
  it('the removed device loses its approval and holds no space key any more; nothing rotates', async () => {
    const s = await account(['a', 'b', 'c']);
    for (const id of ['a', 'a', 'b', 'c']) {
      const t = await trust(s);
      const d = s.devices.get(id)!;
      await maintainGrants(s.doc, { me: id, spaces: ['s1'], certs: t.certs, grants: t.grants, signKey: d.sign.privateKey, agreeKey: d.agree.privateKey });
    }
    const kid = (await trust(s)).grants.get('s1')!.kid;
    await remove(s, 'c');
    const t = await trust(s);
    expect([...t.certs.keys()].sort()).toEqual(['a', 'b']);
    expect([...t.grants.get('s1')!.holders].sort()).toEqual(['a', 'b']);
    expect(t.grants.get('s1')!.kid).toBe(kid);
    expect(keysMap(s.doc).get('removal:c')).toBeDefined();
    expect(isRemoved(s.doc, 'c')).toBe(true);
    expect([...keysMap(s.doc).keys()].some((k) => k.startsWith('epoch'))).toBe(false);
  });

  it('with keys required the plain removed flag changes nothing; a forged removal is ignored', async () => {
    const s = await account(['a', 'b', 'c']);
    setRemoved(s.doc, 'b', true);
    keysMap(s.doc).set('removal:c', { account: s.fp, key: '0'.repeat(32), sig: 'AAAA' });
    expect([...(await trust(s)).certs.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('records of the #258 build (epochs, rotated grants) are ignored; its removals still count', async () => {
    const s = await account(['a', 'b', 'c']);
    await remove(s, 'c');
    keysMap(s.doc).set('epoch:2', { account: s.fp, removed: [['a', '0'.repeat(32)]], keys: {}, sig: 'AAAA' });
    keysMap(s.doc).set('epoch-at:a', { n: 2, kid: '0'.repeat(16) });
    keysMap(s.doc).set('grant:mesh:2:a', { kid: '0'.repeat(16), wrapped: 'x', by: 'account', sig: 'AAAA' });
    const t = await trust(s);
    expect([...t.certs.keys()].sort()).toEqual(['a', 'b']);
    expect(t.grants.has('mesh')).toBe(false);
  });

  it('a removed device back with new keys and a new approval counts again', async () => {
    const s = await account(['a', 'b', 'c']);
    await remove(s, 'c');
    const fresh = await generateDeviceKeys();
    await certifyDevice(s.doc, s.fp, s.acc.privateKey, 'c', fresh.publicKeys, true);
    expect([...(await trust(s)).certs.keys()].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('an asking device with removed keys (#168)', () => {
  it('is recognised by its sign key, not by its id alone', async () => {
    const s = await account(['a', 'b']);
    await remove(s, 'b');
    const record = (await readAccountKeys(s.doc)).find((k) => k.fingerprint === s.fp);
    expect(await isKeyRemoved(s.doc, record, 'b', s.devices.get('b')!.publicKeys.sign)).toBe(true);
    expect(await isKeyRemoved(s.doc, record, 'a', s.devices.get('a')!.publicKeys.sign)).toBe(false);
    const fresh = await generateDeviceKeys();
    expect(await isKeyRemoved(s.doc, record, 'b', fresh.publicKeys.sign)).toBe(false);
  });
});
