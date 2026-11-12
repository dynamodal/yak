import type * as Y from 'yjs';
import { base64, encodeText } from './bytes';
import { keysMap, type AccountKeyRecord } from './account-keys';
import type { DeviceCert } from './key-certs';
import { fingerprint, sign, verifyText, type PublicKeyJwk } from './keys';
import { setRemoved } from './devices';

/**
 * Removing a device in a keys-required account (#258, simplified in #295 under S-258g). The account
 * key signs `removal:<deviceId>` = { account, key, sig }, where `key` is the fingerprint of the
 * device's sign key. Its certificate then stops counting on every device, so no peer verifies its
 * handshake or seals anything to it; it keeps what it already synced (S-76g). Bound to the keys, so
 * the device comes back only with new keys and a new approval (after Leave, which deletes them).
 *
 * Nothing rotates: a removed device still knows the account's sync secret, so it can see hellos on
 * the mailbox topic, but no link, document or relay frame (S-258g puts modified code out of scope).
 * Records an older build wrote (`epoch:`, `epoch-at:`, grants above epoch 1) are ignored.
 */

const REMOVAL_LABEL = 'yak/v1/removal\u0000';

export interface Removal {
  deviceId: string;
  /** Fingerprint of the removed device's sign key. */
  key: string;
}

export const removalTag = (r: Removal): string => `${r.deviceId}:${r.key}`;

const removalText = (fp: string, r: Removal): string => REMOVAL_LABEL + JSON.stringify([fp, r.deviceId, r.key]);

const FP = /^[a-f0-9]{32}$/;

/** One removal record checked against an account key record (also used for the copies in a share's roster, #259). */
export async function verifyRemoval(deviceId: string, value: unknown, account: AccountKeyRecord): Promise<Removal | undefined> {
  const v = value as { account?: unknown; key?: unknown; sig?: unknown } | undefined;
  if (!v || v.account !== account.fingerprint || typeof v.key !== 'string' || !FP.test(v.key) || typeof v.sig !== 'string') return undefined;
  const r = { deviceId, key: v.key };
  return (await verifyText(account.publicKey, removalText(account.fingerprint, r), v.sig)) ? r : undefined;
}

/** The removals the account key `account` signed. */
export async function readRemovals(doc: Y.Doc, account: AccountKeyRecord | undefined): Promise<Removal[]> {
  if (!account) return [];
  const checks: Promise<Removal | undefined>[] = [];
  keysMap(doc).forEach((value, key) => {
    if (key.startsWith('removal:')) checks.push(verifyRemoval(key.slice('removal:'.length), value, account));
  });
  return (await Promise.all(checks)).filter((r): r is Removal => !!r);
}

/** The account key removes these devices' keys, in one transaction; also sets the plain `removed` flag (the device list reads it). */
export async function removeDevices(doc: Y.Doc, fp: string, accountKey: CryptoKey, remove: readonly DeviceCert[]): Promise<void> {
  const records = await Promise.all(
    remove.map(async (c) => {
      const r = { deviceId: c.deviceId, key: await fingerprint(c.sign) };
      return [r.deviceId, { account: fp, key: r.key, sig: base64(await sign(accountKey, encodeText(removalText(fp, r)))) }] as const;
    }),
  );
  doc.transact(() => {
    for (const [id, rec] of records) {
      keysMap(doc).set(`removal:${id}`, rec);
      setRemoved(doc, id, true);
    }
  });
}

/** True when the account key signed a removal of this device id with exactly this sign key (an asking device still holds removed keys, #168). */
export async function isKeyRemoved(doc: Y.Doc, account: AccountKeyRecord | undefined, deviceId: string, sign: PublicKeyJwk): Promise<boolean> {
  const tag = removalTag({ deviceId, key: await fingerprint(sign) });
  return (await readRemovals(doc, account)).some((r) => removalTag(r) === tag);
}
