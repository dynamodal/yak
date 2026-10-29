import * as Y from 'yjs';
import { base64, encodeText } from './bytes';
import type { DeviceKeyRecord } from './account-keys';
import { isSealed, keysMap, readAccountKeys, type AccountKeyRecord } from './account-keys';
import { isLeft, isRemoved } from './devices';
import { fingerprint, isPublicKeyJwk, sameKey, sign, verifyText, type PublicKeyJwk } from './keys';
import { removalTag } from './key-removals';
import { KEYS_REQUIRED_DOC_VERSION } from './migrations';

/**
 * Signed records in the account document's `keys` map (docs/sync.md, Key model, slice 2, #256).
 * The account key signs them; every device checks them before acting, because the document is
 * synced input and in compatible mode anyone with the sync code can write to it.
 *
 * - `cert:<deviceId>`: a device certificate, the account key vouching for that device's public keys.
 *   Version 1 is trust on first use (compatible mode, S-256b); version 2 is an owner's approval (slice 3,
 *   #257). With keys required only version 2 counts, so a certificate issued on first use stops counting
 *   at the switch unless the owner approved that device.
 * - `required`: the account requires device keys (the switch, `requireKeys`).
 *
 * `handover:` records from older builds (a change of account key) are ignored since #295.
 */

export interface DeviceCert {
  deviceId: string;
  /** Fingerprint of the account key that signed it. */
  account: string;
  sign: PublicKeyJwk;
  agree: PublicKeyJwk;
  /** 2: the owner approved this device (slice 3); 1: issued on first use in compatible mode. */
  v: 1 | 2;
}

const CERT_LABEL = 'yak/v1/cert\u0000';
const APPROVED_CERT_LABEL = 'yak/v1/cert2\u0000';
const REQUIRED_LABEL = 'yak/v1/required\u0000';

const certText = (c: DeviceCert): string => (c.v === 2 ? APPROVED_CERT_LABEL : CERT_LABEL) + JSON.stringify([c.deviceId, c.account, c.sign.x, c.sign.y, c.agree.x, c.agree.y]);

/** A signed certificate record, ready to write. Version 1 records keep the slice 2 shape. */
async function certRecord(accountFp: string, accountKey: CryptoKey, deviceId: string, keys: { sign: PublicKeyJwk; agree: PublicKeyJwk }, v: 1 | 2): Promise<Record<string, unknown>> {
  const cert: DeviceCert = { deviceId, account: accountFp, sign: keys.sign, agree: keys.agree, v };
  const sig = base64(await sign(accountKey, encodeText(certText(cert))));
  return { account: accountFp, sign: keys.sign, agree: keys.agree, sig, ...(v === 2 ? { v } : {}) };
}

/** The account key certifies a device's public keys: on first use (compatible mode), or `approved` by the owner. */
export async function certifyDevice(doc: Y.Doc, accountFp: string, accountKey: CryptoKey, deviceId: string, keys: { sign: PublicKeyJwk; agree: PublicKeyJwk }, approved = false): Promise<void> {
  keysMap(doc).set(`cert:${deviceId}`, await certRecord(accountFp, accountKey, deviceId, keys, approved ? 2 : 1));
}

function parseCert(deviceId: string, value: unknown): (DeviceCert & { sig: string }) | undefined {
  const v = value as { account?: unknown; sign?: unknown; agree?: unknown; sig?: unknown; v?: unknown } | undefined;
  if (!v || typeof v.account !== 'string' || typeof v.sig !== 'string' || !isPublicKeyJwk(v.sign) || !isPublicKeyJwk(v.agree)) return undefined;
  return { deviceId, account: v.account, sign: v.sign, agree: v.agree, sig: v.sig, v: v.v === 2 ? 2 : 1 };
}

async function verifiedBy(account: AccountKeyRecord | undefined, text: string, sig: string): Promise<boolean> {
  return account ? verifyText(account.publicKey, text, sig) : false;
}

/** The account key record `accountFp`, from keys already read when the caller has them. */
async function accountRecord(doc: Y.Doc, accountFp: string, accounts?: readonly AccountKeyRecord[]): Promise<AccountKeyRecord | undefined> {
  return (accounts ?? (await readAccountKeys(doc))).find((k) => k.fingerprint === accountFp);
}

/**
 * One certificate record checked against an account key record: signed by that key, for that account.
 * Used for the copies in a share's roster (#259), which are checked by the same code as the account document's own.
 */
export async function verifyCert(deviceId: string, value: unknown, account: AccountKeyRecord): Promise<DeviceCert | undefined> {
  const c = parseCert(deviceId, value);
  if (!c || c.account !== account.fingerprint) return undefined;
  return (await verifiedBy(account, certText(c), c.sig)) ? { deviceId, account: c.account, sign: c.sign, agree: c.agree, v: c.v } : undefined;
}

/** Every certificate the account key `accountFp` signed, removed or left or not, with its version. */
async function signedCerts(doc: Y.Doc, accountFp: string, accounts?: readonly AccountKeyRecord[]): Promise<DeviceCert[]> {
  const account = await accountRecord(doc, accountFp, accounts);
  if (!account) return [];
  const checks: Promise<DeviceCert | undefined>[] = [];
  keysMap(doc).forEach((value, key) => {
    if (!key.startsWith('cert:')) return;
    const id = key.slice('cert:'.length);
    const c = parseCert(id, value);
    if (!c || c.account !== accountFp) return;
    checks.push(verifiedBy(account, certText(c), c.sig).then((ok) => (ok ? { deviceId: id, account: c.account, sign: c.sign, agree: c.agree, v: c.v } : undefined)));
  });
  return (await Promise.all(checks)).filter((c): c is DeviceCert => !!c);
}

/**
 * Every device certificate in the document that the account key `accountFp` signed. A left device's
 * certificate does not count. With `approved` (keys required) only an owner's approval counts, and a
 * device is removed only by a signed removal of its keys (`removed`, tags from `key-removals.ts`; #258):
 * the plain `removed` flag, which any device can write, is ignored. Without it the flag counts.
 */
export async function readCerts(doc: Y.Doc, accountFp: string | undefined, accounts?: readonly AccountKeyRecord[], approved = false, removed: ReadonlySet<string> = new Set()): Promise<Map<string, DeviceCert>> {
  const out = new Map<string, DeviceCert>();
  if (!accountFp) return out;
  for (const c of await signedCerts(doc, accountFp, accounts)) {
    if ((approved ? c.v !== 2 : isRemoved(doc, c.deviceId)) || isLeft(doc, c.deviceId)) continue;
    if (approved && removed.size > 0 && removed.has(removalTag({ deviceId: c.deviceId, key: await fingerprint(c.sign) }))) continue;
    out.set(c.deviceId, c);
  }
  return out;
}

/** The device has a certificate for exactly these public keys (a device that lost its keys and made new ones needs a new one). */
export function certMatches(cert: DeviceCert | undefined, keys: { sign: PublicKeyJwk; agree: PublicKeyJwk } | undefined): boolean {
  return !!cert && !!keys && sameKey(cert.sign, keys.sign) && sameKey(cert.agree, keys.agree);
}

const requiredText = (fp: string): string => REQUIRED_LABEL + fp;

const requiredRecord = async (accountFp: string, accountKey: CryptoKey): Promise<{ account: string; sig: string }> => ({ account: accountFp, sig: base64(await sign(accountKey, encodeText(requiredText(accountFp)))) });

/** The bare "keys required" mark, without approvals or the version bump (tests of slice 2's rules). The app uses `requireKeys`. */
export async function markKeysRequired(doc: Y.Doc, accountFp: string, accountKey: CryptoKey): Promise<void> {
  keysMap(doc).set('required', await requiredRecord(accountFp, accountKey));
}

/** Raise the document's version so builds that do not know keys required stop syncing it and say to update (#257). Only ever raised. */
function markRequiredVersion(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>('meta');
  const v = meta.get('schema_version');
  if (typeof v !== 'number' || v < KEYS_REQUIRED_DOC_VERSION) meta.set('schema_version', KEYS_REQUIRED_DOC_VERSION);
  meta.set(`migrated:${KEYS_REQUIRED_DOC_VERSION}`, true);
}

/**
 * The switch (one way, S-76n, #257): the owner approved these devices after comparing names and
 * fingerprints (`me`, the device that switches, always among them). In one transaction each gets an approved certificate, the account key signs
 * "keys required", and the document's version goes up. Every other certificate stops counting.
 */
export async function requireKeys(doc: Y.Doc, accountFp: string, accountKey: CryptoKey, approved: readonly DeviceKeyRecord[], me: string): Promise<void> {
  // The device that switches must stay in: without its own approval it would lock itself out.
  if (!approved.some((d) => d.deviceId === me)) throw new Error('This device must be among the approved devices.');
  const certs = await Promise.all(approved.map(async (d) => [d.deviceId, await certRecord(accountFp, accountKey, d.deviceId, d, 2)] as const));
  const required = await requiredRecord(accountFp, accountKey);
  doc.transact(() => {
    for (const [id, rec] of certs) keysMap(doc).set(`cert:${id}`, rec);
    keysMap(doc).set('required', required);
    markRequiredVersion(doc);
  });
}

/** Whether the account key `accountFp` has signed "keys required". An unsigned or foreign mark is ignored. */
export async function keysRequired(doc: Y.Doc, accountFp: string | undefined, accounts?: readonly AccountKeyRecord[]): Promise<boolean> {
  const v = keysMap(doc).get('required') as { account?: unknown; sig?: unknown } | undefined;
  if (!accountFp || !v || v.account !== accountFp || typeof v.sig !== 'string') return false;
  return verifiedBy(await accountRecord(doc, accountFp, accounts), requiredText(accountFp), v.sig);
}

/** The account key this device follows, kept beside the document so a write to `chosen` alone cannot move it. */
export interface PinnedChoice {
  fingerprint: string;
  /** Seen sealed once: from then on nothing moves the account off it. */
  sealed: boolean;
  /** The pinned key itself, so a deleted `account:` record cannot take the device elsewhere. */
  publicKey?: PublicKeyJwk;
  /** Its creator, as published when it was pinned. */
  by?: string;
}

export interface ChosenCheck {
  /** The fingerprint to follow, or undefined when the account has none yet. */
  fingerprint: string | undefined;
  /** The document names another key and this device refuses to follow it. */
  refused?: string;
  /** Why a change was accepted, for the log. */
  accepted?: 'first' | 'same' | 'creator gone';
}

/**
 * Verify a change of `keys.chosen` on receive (#256, review of #282). The document's choice is
 * followed when nothing is pinned yet (trust on first use, compatible mode), when it is the pinned
 * key, or by the replaced-key rule while the pinned key was never sealed and its creator was removed
 * or left (`sealAccount`). Anything else (an unsigned overwrite, a key claiming to come from the same
 * creator, a sealed key replaced) is refused and the pinned key stays.
 */
export async function checkChosen(doc: Y.Doc, chosen: string | undefined, pinned: PinnedChoice | undefined): Promise<ChosenCheck> {
  if (!chosen) return { fingerprint: pinned?.fingerprint };
  if (!pinned) return { fingerprint: chosen, accepted: 'first' };
  if (chosen === pinned.fingerprint) return { fingerprint: chosen, accepted: 'same' };
  const keys = await readAccountKeys(doc);
  // The pinned key as pinned, not as the document now says: its record may have been deleted or rewritten.
  const pinnedKey: AccountKeyRecord | undefined = pinned.publicKey
    ? { fingerprint: pinned.fingerprint, publicKey: pinned.publicKey, by: pinned.by ?? '', at: 0, sealed: pinned.sealed }
    : keys.find((k) => k.fingerprint === pinned.fingerprint);
  const next = keys.find((k) => k.fingerprint === chosen);
  if (!next) return { fingerprint: pinned.fingerprint, refused: chosen };
  if (!pinned.sealed && !isSealed(doc, pinned.fingerprint)) {
    const by = pinnedKey?.by ?? '';
    if (by && (isRemoved(doc, by) || isLeft(doc, by))) return { fingerprint: chosen, accepted: 'creator gone' };
  }
  return { fingerprint: pinned.fingerprint, refused: chosen };
}

/** The records an approving device may hand a new one (#257): nothing else is copied into its account document. */
const APPROVAL_RECORD = /^(?:(?:account|sealed|cert|device):[A-Za-z0-9-]+|chosen|required)$/;

/**
 * Check an approval before following it (#257): the account key the new device compared, signed
 * "keys required", and an approved certificate for exactly this device's keys. Returns the records
 * to keep, or undefined when anything is off.
 */
export async function checkApproval(records: readonly [string, unknown][], accountFp: string, me: string, own: { sign: PublicKeyJwk; agree: PublicKeyJwk }): Promise<[string, unknown][] | undefined> {
  const kept = records.filter((r): r is [string, unknown] => Array.isArray(r) && typeof r[0] === 'string' && APPROVAL_RECORD.test(r[0]));
  const doc = new Y.Doc();
  for (const [k, v] of kept) keysMap(doc).set(k, v);
  const accounts = await readAccountKeys(doc);
  if (!accounts.some((a) => a.fingerprint === accountFp) || !(await keysRequired(doc, accountFp, accounts))) return undefined;
  return certMatches((await readCerts(doc, accountFp, accounts, true)).get(me), own) ? kept : undefined;
}
