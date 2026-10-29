import type * as Y from 'yjs';
import { base64, decodeText, encodeText, unbase64 } from './bytes';
import { decryptBytes, DEFAULT_ITERATIONS, encryptBytes, InvalidParamsError, iterationsValid } from './crypto';
import { fingerprint, isPublicKeyJwk, type PublicKeyJwk } from './keys';

/**
 * Key records in the account document's `keys` map (docs/sync.md, "Key model", slice 1). Nothing
 * here is enforced yet: compatible mode only publishes keys.
 *
 * Keys are `account:<fingerprint>`, `sealed:<fingerprint>`, `device:<deviceId>` and `chosen` (the
 * fingerprint every device follows). A field per fingerprint means two devices that create an
 * account key at the same time both keep theirs; `chosen` is written only while absent, so Yjs
 * settles concurrent writes the same way on every device (S-76s).
 */

const KEYS = 'keys';

export interface AccountKeyRecord {
  /** 32 hex characters. */
  fingerprint: string;
  publicKey: PublicKeyJwk;
  /** The device that created it (it holds the private half until the passphrase seals it). */
  by: string;
  /** When it was made (the creator's clock; untrusted, shown only). */
  at: number;
  /** The private half is sealed with the passphrase in the document. */
  sealed: boolean;
}

export interface DeviceKeyRecord {
  deviceId: string;
  sign: PublicKeyJwk;
  agree: PublicKeyJwk;
  /** What the device's build understands: 3 = keys required and approval (#257); absent from older builds. */
  v?: number;
}

/** The `v` this build writes on its device record: it can run in a keys-required account. */
export const KEYS_REQUIRED_LEVEL = 3;

export function keysMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(KEYS);
}

const FINGERPRINT = /^[a-f0-9]{32}$/;

/** The account id of a key fingerprint. */
export const accountIdOfFingerprint = (fp: string): string => fp.slice(0, 24);

/** The fingerprint every device follows, if the account has settled on one. */
export function chosenFingerprint(doc: Y.Doc): string | undefined {
  const v = keysMap(doc).get('chosen');
  return typeof v === 'string' && FINGERPRINT.test(v) ? v : undefined;
}

/** Write `chosen` unless the account already has one (the first device to settle decides). */
export function chooseIfAbsent(doc: Y.Doc, fp: string): void {
  if (chosenFingerprint(doc) === undefined) keysMap(doc).set('chosen', fp);
}

/** Publish an account public key; it becomes the chosen one when none is. Several may exist at once (concurrent creation). */
export function publishAccountKey(doc: Y.Doc, fp: string, publicKey: PublicKeyJwk, by: string, at = Date.now()): void {
  doc.transact(() => {
    keysMap(doc).set(`account:${fp}`, { public: publicKey, by, at });
    chooseIfAbsent(doc, fp);
  });
}

/** The account public keys in the document whose fingerprint matches the key itself. The document is synced input: a bad record is skipped, never an error. */
export async function readAccountKeys(doc: Y.Doc): Promise<AccountKeyRecord[]> {
  const found: AccountKeyRecord[] = [];
  const checks: Promise<void>[] = [];
  keysMap(doc).forEach((value, key) => {
    if (!key.startsWith('account:')) return;
    const fp = key.slice('account:'.length);
    const v = value as { public?: unknown; by?: unknown; at?: unknown } | undefined;
    if (!FINGERPRINT.test(fp) || !v || !isPublicKeyJwk(v.public)) return;
    const publicKey = v.public;
    checks.push(
      fingerprint(publicKey).then(
        (actual) => {
          if (actual === fp) found.push({ fingerprint: fp, publicKey, by: typeof v.by === 'string' ? v.by : '', at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0, sealed: isSealed(doc, fp) });
        },
        () => undefined,
      ),
    );
  });
  await Promise.all(checks);
  return found.sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
}

/**
 * The account key every device follows (S-76s): the `chosen` one, decided by the document alone.
 * Without a valid `chosen` (none yet, or one that names no valid key) the caller picks with `pickAccountKey` and writes it.
 */
export function chooseAccountKey(keys: readonly AccountKeyRecord[], chosen: string | undefined): AccountKeyRecord | undefined {
  return keys.find((k) => k.fingerprint === chosen);
}

/** A first choice when there is none: a sealed key if there is one, then the lowest fingerprint. */
export function pickAccountKey(keys: readonly AccountKeyRecord[]): AccountKeyRecord | undefined {
  return keys.find((k) => k.sealed) ?? keys[0];
}

export async function winningAccountKey(doc: Y.Doc): Promise<AccountKeyRecord | undefined> {
  return chooseAccountKey(await readAccountKeys(doc), chosenFingerprint(doc));
}

/** What the Backups and Devices pages need to know about the chosen key, without checking signatures. */
export function chosenKeyState(doc: Y.Doc): { fingerprint: string; sealed: boolean; by: string } | undefined {
  const fp = chosenFingerprint(doc);
  if (!fp) return undefined;
  const rec = keysMap(doc).get(`account:${fp}`) as { by?: unknown } | undefined;
  return rec ? { fingerprint: fp, sealed: isSealed(doc, fp), by: typeof rec.by === 'string' ? rec.by : '' } : undefined;
}

const SEAL_LABEL = 'yak/v1/account-key\u0000';

interface Sealed {
  salt: string;
  iterations: number;
  data: string;
}

/**
 * A key from the passphrase with its own salt and purpose label, never stored: it only exists while
 * the passphrase is typed. The backup key (kept on devices, S18) cannot open a sealed account key.
 */
async function sealKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encodeText(SEAL_LABEL + passphrase) as Uint8Array<ArrayBuffer>, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Seal the account private key with the passphrase (S-76b): it then lives in the document and in backups. */
export async function sealAccountKey(doc: Y.Doc, fp: string, privateKey: CryptoKey, passphrase: string, iterations = DEFAULT_ITERATIONS): Promise<void> {
  if (!iterationsValid(iterations)) throw new InvalidParamsError();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  const data = await encryptBytes(await sealKey(passphrase, salt, iterations), encodeText(JSON.stringify(jwk)));
  keysMap(doc).set(`sealed:${fp}`, { salt: base64(salt), iterations, data: base64(data) } satisfies Sealed);
}

function readSealed(doc: Y.Doc, fp: string): Sealed | undefined {
  const v = keysMap(doc).get(`sealed:${fp}`) as Partial<Sealed> | undefined;
  return v && typeof v.salt === 'string' && typeof v.data === 'string' && typeof v.iterations === 'number' ? (v as Sealed) : undefined;
}

export function isSealed(doc: Y.Doc, fp: string): boolean {
  return readSealed(doc, fp) !== undefined;
}

/** The account private key from its sealed copy; throws `WrongPassphraseError` for another passphrase. */
export async function unsealAccountKey(doc: Y.Doc, fp: string, passphrase: string): Promise<CryptoKey | undefined> {
  const sealed = readSealed(doc, fp);
  if (!sealed) return undefined;
  if (!iterationsValid(sealed.iterations)) throw new InvalidParamsError();
  const key = await sealKey(passphrase, unbase64(sealed.salt), sealed.iterations);
  const jwk = JSON.parse(decodeText(await decryptBytes(key, unbase64(sealed.data)))) as JsonWebKey;
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
}

/** Publish a device's public keys; `level` is what its build understands (this build's own device: `KEYS_REQUIRED_LEVEL`). */
export function publishDeviceKeys(doc: Y.Doc, deviceId: string, keys: { sign: PublicKeyJwk; agree: PublicKeyJwk }, level = KEYS_REQUIRED_LEVEL): void {
  const current = readDeviceKey(doc, deviceId);
  if (current && JSON.stringify(current.sign) === JSON.stringify(keys.sign) && JSON.stringify(current.agree) === JSON.stringify(keys.agree) && (current.v ?? 0) >= level) return;
  keysMap(doc).set(`device:${deviceId}`, { sign: keys.sign, agree: keys.agree, v: Math.max(level, current?.v ?? 0) });
}

function parseDevice(deviceId: string, value: unknown): DeviceKeyRecord | undefined {
  const v = value as { sign?: unknown; agree?: unknown; v?: unknown } | undefined;
  return v && isPublicKeyJwk(v.sign) && isPublicKeyJwk(v.agree) ? { deviceId, sign: v.sign, agree: v.agree, ...(typeof v.v === 'number' ? { v: v.v } : {}) } : undefined;
}

export function readDeviceKey(doc: Y.Doc | undefined, deviceId: string): DeviceKeyRecord | undefined {
  return doc ? parseDevice(deviceId, keysMap(doc).get(`device:${deviceId}`)) : undefined;
}

/** Devices that have published keys. */
export function readDeviceKeys(doc: Y.Doc | undefined): Map<string, DeviceKeyRecord> {
  const out = new Map<string, DeviceKeyRecord>();
  if (!doc) return out;
  keysMap(doc).forEach((value, key) => {
    if (!key.startsWith('device:')) return;
    const id = key.slice('device:'.length);
    const rec = parseDevice(id, value);
    if (rec) out.set(id, rec);
  });
  return out;
}

/** Short fingerprint of a device's signing key, for the Devices page. */
export function deviceFingerprint(record: DeviceKeyRecord): Promise<string> {
  return fingerprint(record.sign);
}
