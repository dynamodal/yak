import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { publishAccountKey, publishDeviceKeys, readDeviceKey } from '../../src/core/account-keys';
import { requireKeys } from '../../src/core/key-certs';
import { removeDevices } from '../../src/core/key-removals';
import { fingerprint, generateAccountKey, generateDeviceKeys } from '../../src/core/keys';
import { readCerts } from '../../src/core/key-certs';
import { readAccountKeys } from '../../src/core/account-keys';
import { KeyTrust } from '../../src/app/key-trust';
import { PluginKeys, type KeyData } from './plugin-keys';

async function vault(opts: { required: boolean; removed?: boolean; flag?: boolean }) {
  const doc = new Y.Doc();
  const acc = await generateAccountKey();
  const fp = await fingerprint(acc.publicKey);
  publishAccountKey(doc, fp, acc.publicKey, 'owner', 0);
  const mine = await generateDeviceKeys();
  const owner = await generateDeviceKeys();
  publishDeviceKeys(doc, 'owner', owner.publicKeys);
  publishDeviceKeys(doc, 'me', mine.publicKeys);
  const trust = new KeyTrust();
  if (opts.required) {
    await requireKeys(doc, fp, acc.privateKey, [readDeviceKey(doc, 'owner')!, readDeviceKey(doc, 'me')!], 'owner');
    trust.isRequired = true;
    if (opts.removed) {
      const certs = await readCerts(doc, fp, await readAccountKeys(doc), true);
      await removeDevices(doc, fp, acc.privateKey, [certs.get('me')!]);
    }
  }
  const data: KeyData = opts.flag ? { removed: true } : {};
  const pk = new PluginKeys({ me: 'me', data, trust } as never);
  Object.assign(pk, { doc, keys: mine });
  return pk;
}

describe('a vault joining with a code (#168)', () => {
  it('makes new keys when its keys were removed, even though it never noticed', async () => {
    expect(await (await vault({ required: true, removed: true })).keysUnusable()).toBe(true);
  });
  it('makes new keys in a keys-required account, whose local copy may predate a removal', async () => {
    expect(await (await vault({ required: true })).keysUnusable()).toBe(true);
  });
  it('makes new keys when it noticed the removal', async () => {
    expect(await (await vault({ required: false, flag: true })).keysUnusable()).toBe(true);
  });
  it('keeps its keys in a compatible account', async () => {
    expect(await (await vault({ required: false })).keysUnusable()).toBe(false);
  });
  it('keeps its keys on a first join, with no account document yet', async () => {
    const pk = new PluginKeys({ me: 'me', data: {}, trust: new KeyTrust() } as never);
    Object.assign(pk, { keys: await generateDeviceKeys() });
    expect(await pk.keysUnusable()).toBe(false);
  });
});
