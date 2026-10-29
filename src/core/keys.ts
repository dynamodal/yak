import { base64, base64url, unbase64, unbase64url } from './bytes';

/**
 * Key pairs of the account and its devices (docs/sync.md, "Key model", S-76a–c, S-76o): WebCrypto
 * P-256 only, no dependency. The account key pair signs (ECDSA); a device has one pair to sign and
 * one to agree keys (ECDH) whose private halves are non-extractable. A key is published as a JWK
 * holding only `x` and `y`; its fingerprint is a SHA-256 over those coordinates.
 */

export interface PublicKeyJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

const CURVE = 'P-256';
const SIGN = { name: 'ECDSA', namedCurve: CURVE } as const;
const AGREE = { name: 'ECDH', namedCurve: CURVE } as const;
const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const;
const WRAP_INFO = new TextEncoder().encode('yak/v1/wrap');

/** A P-256 coordinate: 32 bytes, 43 base64url characters. */
const COORDINATE = /^[A-Za-z0-9_-]{43}$/;

/** A published key is untrusted input from a synced document: accept only the exact shape. */
export function isPublicKeyJwk(v: unknown): v is PublicKeyJwk {
  const k = v as Partial<PublicKeyJwk> | null;
  return !!k && typeof k === 'object' && k.kty === 'EC' && k.crv === CURVE && COORDINATE.test(String(k.x)) && COORDINATE.test(String(k.y));
}

async function publicJwk(key: CryptoKey): Promise<PublicKeyJwk> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return { kty: 'EC', crv: CURVE, x: jwk.x as string, y: jwk.y as string };
}

/** The 64 bytes `x || y`, the canonical form a fingerprint is taken over. */
function coordinates(jwk: PublicKeyJwk): Uint8Array {
  const x = unbase64url(jwk.x);
  const y = unbase64url(jwk.y);
  const out = new Uint8Array(64);
  out.set(x, 32 - x.length);
  out.set(y, 64 - y.length);
  return out;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** A bounded memo: the oldest entry goes first. */
function remember<V>(map: Map<string, V>, key: string, value: V, max = 2000): V {
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value as string);
  return value;
}

const fingerprints = new Map<string, string>();

/** Fingerprint of a public key: 32 hex characters (the first 16 bytes of SHA-256). Remembered per key. */
export async function fingerprint(jwk: PublicKeyJwk): Promise<string> {
  const memo = `${jwk.x}.${jwk.y}`;
  const known = fingerprints.get(memo);
  if (known) return known;
  return remember(fingerprints, memo, hex(new Uint8Array(await crypto.subtle.digest('SHA-256', coordinates(jwk) as Uint8Array<ArrayBuffer>)).slice(0, 16)));
}

/** The account id of an account key: the first 24 hex characters of its fingerprint (the id format since the first version). */
export async function accountIdOfKey(jwk: PublicKeyJwk): Promise<string> {
  return (await fingerprint(jwk)).slice(0, 24);
}

/** A fingerprint as shown to a person comparing two screens: groups of four. */
export function formatFingerprint(fp: string, groups = 4): string {
  return (fp.match(/.{1,4}/g) ?? []).slice(0, groups).join(' ');
}

export interface AccountKeyPair {
  publicKey: PublicKeyJwk;
  /** Extractable: it is stored encrypted with the passphrase, so it must be exported. */
  privateKey: CryptoKey;
}

export async function generateAccountKey(): Promise<AccountKeyPair> {
  const pair = await crypto.subtle.generateKey(SIGN, true, ['sign', 'verify']);
  return { publicKey: await publicJwk(pair.publicKey), privateKey: pair.privateKey };
}

export interface DeviceKeyPairs {
  sign: CryptoKeyPair;
  agree: CryptoKeyPair;
  publicKeys: { sign: PublicKeyJwk; agree: PublicKeyJwk };
}

/** Private halves are non-extractable: they never leave the browser's key storage. `extractable` only where there is no such storage (S-76p). */
export async function generateDeviceKeys(extractable = false): Promise<DeviceKeyPairs> {
  const sign = await crypto.subtle.generateKey(SIGN, extractable, ['sign', 'verify']);
  const agree = await crypto.subtle.generateKey(AGREE, extractable, ['deriveBits']);
  return { sign, agree, publicKeys: { sign: await publicJwk(sign.publicKey), agree: await publicJwk(agree.publicKey) } };
}

/** Device keys written out, for a device without protected key storage (the Obsidian plugin's settings file, S-76p). */
export interface DeviceKeysJwk {
  sign: JsonWebKey;
  agree: JsonWebKey;
}

export async function exportDeviceKeys(k: DeviceKeyPairs): Promise<DeviceKeysJwk> {
  return { sign: await crypto.subtle.exportKey('jwk', k.sign.privateKey), agree: await crypto.subtle.exportKey('jwk', k.agree.privateKey) };
}

export async function importDeviceKeys(j: DeviceKeysJwk): Promise<DeviceKeyPairs> {
  const pub = (k: JsonWebKey): PublicKeyJwk => ({ kty: 'EC', crv: CURVE, x: k.x as string, y: k.y as string });
  const sign = { privateKey: await crypto.subtle.importKey('jwk', j.sign, SIGN, true, ['sign']), publicKey: await crypto.subtle.importKey('jwk', pub(j.sign), SIGN, true, ['verify']) };
  const agree = { privateKey: await crypto.subtle.importKey('jwk', j.agree, AGREE, true, ['deriveBits']), publicKey: await crypto.subtle.importKey('jwk', pub(j.agree), AGREE, true, []) };
  return { sign, agree, publicKeys: { sign: pub(j.sign), agree: pub(j.agree) } };
}

export async function sign(privateKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign(SIGNATURE, privateKey, data as Uint8Array<ArrayBuffer>));
}

const verified = new Map<string, boolean>();

/**
 * `verify` for signed records in the account document, remembered per key, text and signature: the
 * same records are checked again on every change of the document, and the answer cannot change.
 */
export async function verifyText(publicKey: PublicKeyJwk, text: string, signature: string): Promise<boolean> {
  const memo = `${publicKey.x}.${publicKey.y}|${signature}|${text}`;
  const known = verified.get(memo);
  if (known !== undefined) return known;
  let ok = false;
  try {
    ok = await verify(publicKey, new TextEncoder().encode(text), unbase64(signature));
  } catch {
    ok = false;
  }
  return remember(verified, memo, ok);
}

export async function verify(publicKey: PublicKeyJwk, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('jwk', publicKey, SIGN, false, ['verify']);
    return await crypto.subtle.verify(SIGNATURE, key, signature as Uint8Array<ArrayBuffer>, data as Uint8Array<ArrayBuffer>);
  } catch {
    return false;
  }
}

async function agreedKey(privateKey: CryptoKey, peerPublic: PublicKeyJwk, ephemeralPublic: PublicKeyJwk): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey('jwk', peerPublic, AGREE, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: coordinates(ephemeralPublic) as Uint8Array<ArrayBuffer>, info: WRAP_INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** A key wrapped to a recipient's ECDH public key: base64 of `ephemeral public (x,y) || iv || ciphertext`. */
export async function wrapFor(recipient: PublicKeyJwk, data: Uint8Array): Promise<string> {
  const ephemeral = await crypto.subtle.generateKey(AGREE, true, ['deriveBits']);
  const ephemeralPublic = await publicJwk(ephemeral.publicKey);
  const key = await agreedKey(ephemeral.privateKey, recipient, ephemeralPublic);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as Uint8Array<ArrayBuffer>));
  const out = new Uint8Array(64 + 12 + ct.length);
  out.set(coordinates(ephemeralPublic));
  out.set(iv, 64);
  out.set(ct, 76);
  return base64(out);
}

export async function unwrap(privateKey: CryptoKey, wrapped: string): Promise<Uint8Array> {
  const bytes = unbase64(wrapped);
  if (bytes.length < 64 + 12 + 16) throw new Error('Malformed wrapped key.');
  const ephemeralPublic: PublicKeyJwk = { kty: 'EC', crv: CURVE, x: base64url(bytes.subarray(0, 32)), y: base64url(bytes.subarray(32, 64)) };
  const key = await agreedKey(privateKey, ephemeralPublic, ephemeralPublic);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(64, 76) as Uint8Array<ArrayBuffer> }, key, bytes.subarray(76) as Uint8Array<ArrayBuffer>));
}

/**
 * The key two devices share (S-76f): ECDH of one device's private agree key and the other's public
 * one, then HKDF with a salt (the topic) and an info string naming the pair, so it differs per pair
 * and per purpose. Both ends derive the same key; nobody else can.
 */
export async function pairKey(privateKey: CryptoKey, peerPublic: PublicKeyJwk, salt: string, info: string): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey('jwk', peerPublic, AGREE, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const enc = new TextEncoder();
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(salt), info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Two public keys are the same key. */
export const sameKey = (a: PublicKeyJwk, b: PublicKeyJwk): boolean => a.x === b.x && a.y === b.y;
