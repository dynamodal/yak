import type * as Y from 'yjs';
import { base64, encodeText } from './bytes';
import { keysMap, readAccountKeys, type AccountKeyRecord } from './account-keys';
import type { DeviceCert } from './key-certs';
import { keeps } from './keeps';
import { sign, unwrap, verifyText, wrapFor, type PublicKeyJwk } from './keys';

/**
 * Space keys for own devices (docs/sync.md, "Key model", slice 2, S-76e): a random 256-bit key per
 * space, wrapped to each certified device that keeps the space. A grant is the wrapped copy, signed by
 * the account key or by a certified device; `allowsDoc` in keys-required mode asks whether the peer
 * holds it. Epoch 1 only: nothing is encrypted with space keys yet, so a removal rotates nothing
 * (#295); sharing between accounts (#259) adds rotation when it encrypts.
 *
 * Record: `grant:<spaceId>:<epoch>:<deviceId>` = { kid, wrapped, by, sig }. `kid` names the key (a
 * hash of it). The first key of a space is recorded in `established:<spaceId>:1`, written only while
 * absent, so Yjs settles two first keys made at the same moment the same way on every device; holders
 * of that key wrap it to the others, replacing their copies. Grants of other epochs (written by the
 * #258 build when it rotated keys, including its `mesh` grants) are ignored.
 */

export const FIRST_EPOCH = 1;
const GRANT_LABEL = 'yak/v1/grant\u0000';
const BY_ACCOUNT = 'account';

export interface SpaceGrants {
  epoch: number;
  /** The key every holder converges on. */
  kid: string;
  /** Devices holding it. */
  holders: Set<string>;
}

interface GrantRecord {
  space: string;
  epoch: number;
  device: string;
  kid: string;
  wrapped: string;
  by: string;
  sig: string;
}

const grantText = (g: Omit<GrantRecord, 'sig'>): string => GRANT_LABEL + JSON.stringify([g.space, g.epoch, g.device, g.kid, g.wrapped, g.by]);
const grantKey = (space: string, epoch: number, device: string): string => `grant:${space}:${epoch}:${device}`;
const establishedKey = (space: string, epoch: number): string => `established:${space}:${epoch}`;

function established(doc: Y.Doc, space: string, epoch: number): string | undefined {
  const v = keysMap(doc).get(establishedKey(space, epoch));
  return typeof v === 'string' ? v : undefined;
}

/** A key's id: the first 16 hex characters of its SHA-256. */
export async function keyId(key: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', key as Uint8Array<ArrayBuffer>));
  return Array.from(d.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface GrantSigner {
  /** A device id, or undefined for the account key. */
  deviceId?: string;
  key: CryptoKey;
}

/** Wrap a space key to one device and sign the grant. */
export async function grantSpace(doc: Y.Doc, space: string, epoch: number, key: Uint8Array, to: { deviceId: string; agree: PublicKeyJwk }, signer: GrantSigner): Promise<void> {
  const g = { space, epoch, device: to.deviceId, kid: await keyId(key), wrapped: await wrapFor(to.agree, key), by: signer.deviceId ?? BY_ACCOUNT };
  const sig = base64(await sign(signer.key, encodeText(grantText(g))));
  keysMap(doc).set(grantKey(space, epoch, to.deviceId), { kid: g.kid, wrapped: g.wrapped, by: g.by, sig });
}

function parseGrant(key: string, value: unknown): GrantRecord | undefined {
  const m = /^grant:(.+):(\d+):([^:]+)$/.exec(key);
  const v = value as Partial<GrantRecord> | undefined;
  if (!m || !v || typeof v.kid !== 'string' || typeof v.wrapped !== 'string' || typeof v.by !== 'string' || typeof v.sig !== 'string') return undefined;
  return { space: m[1] as string, epoch: Number(m[2]), device: m[3] as string, kid: v.kid, wrapped: v.wrapped, by: v.by, sig: v.sig };
}

/**
 * The grants that count, per space: epoch 1, signed by the account key `accountFp` or by a certified
 * device, to a certified device; the established key (the marker, else the lowest key id until the
 * marker arrives). `accounts`: the account keys, when the caller has read them already.
 */
export async function readGrants(doc: Y.Doc, accountFp: string | undefined, certs: ReadonlyMap<string, DeviceCert>, accounts?: readonly AccountKeyRecord[]): Promise<Map<string, SpaceGrants>> {
  const out = new Map<string, SpaceGrants>();
  if (!accountFp) return out;
  const account = (accounts ?? (await readAccountKeys(doc))).find((k) => k.fingerprint === accountFp);
  const valid: GrantRecord[] = [];
  const checks: Promise<void>[] = [];
  keysMap(doc).forEach((value, key) => {
    if (!key.startsWith('grant:')) return;
    const g = parseGrant(key, value);
    if (!g || g.epoch !== FIRST_EPOCH || !certs.has(g.device)) return;
    const signer = g.by === BY_ACCOUNT ? account?.publicKey : certs.get(g.by)?.sign;
    if (!signer) return;
    checks.push(verifyText(signer, grantText(g), g.sig).then((ok) => void (ok && valid.push(g))));
  });
  await Promise.all(checks);
  const kids = new Map<string, Set<string>>();
  for (const g of valid) kids.set(g.space, (kids.get(g.space) ?? new Set()).add(g.kid));
  for (const [space, set] of kids) {
    const marked = established(doc, space, FIRST_EPOCH);
    out.set(space, { epoch: FIRST_EPOCH, kid: marked !== undefined && set.has(marked) ? marked : ([...set].sort()[0] as string), holders: new Set() });
  }
  for (const g of valid) {
    const cur = out.get(g.space);
    if (cur && g.kid === cur.kid) cur.holders.add(g.device);
  }
  return out;
}

/** This device's copy of a space key, if its grant is the current one. */
export async function openGrant(doc: Y.Doc, space: string, state: SpaceGrants | undefined, me: string, agree: CryptoKey): Promise<Uint8Array | undefined> {
  if (!state?.holders.has(me)) return undefined;
  const g = parseGrant(grantKey(space, state.epoch, me), keysMap(doc).get(grantKey(space, state.epoch, me)));
  if (!g) return undefined;
  try {
    return await unwrap(agree, g.wrapped);
  } catch {
    return undefined;
  }
}

/**
 * Keep space keys with the devices that keep the spaces (S9: each pick wraps the key to that device).
 * A certified device that keeps a space nobody holds a key for makes the first one; a holder wraps it
 * to every certified device that keeps the space and lacks it. Returns how many grants were written.
 */
export async function maintainGrants(
  doc: Y.Doc,
  o: { me: string; spaces: readonly string[]; certs: ReadonlyMap<string, DeviceCert>; grants: ReadonlyMap<string, SpaceGrants>; signKey: CryptoKey; agreeKey: CryptoKey },
): Promise<number> {
  const mine = o.certs.get(o.me);
  if (!mine) return 0;
  let written = 0;
  const signer = { deviceId: o.me, key: o.signKey };
  for (const space of o.spaces) {
    const state = o.grants.get(space);
    if (!state) {
      if (!keeps(doc, o.me, space)) continue;
      const key = crypto.getRandomValues(new Uint8Array(32));
      await grantSpace(doc, space, FIRST_EPOCH, key, { deviceId: o.me, agree: mine.agree }, signer);
      if (established(doc, space, FIRST_EPOCH) === undefined) keysMap(doc).set(establishedKey(space, FIRST_EPOCH), await keyId(key));
      written++;
      continue;
    }
    const key = await openGrant(doc, space, state, o.me, o.agreeKey);
    if (!key) continue;
    for (const [id, cert] of o.certs) {
      if (state.holders.has(id) || !keeps(doc, id, space)) continue;
      await grantSpace(doc, space, state.epoch, key, { deviceId: id, agree: cert.agree }, signer);
      written++;
    }
  }
  return written;
}
