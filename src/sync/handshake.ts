import { base64, encodeText, unbase64 } from '../core/bytes';
import { pairKey, sign, verify, type PublicKeyJwk } from '../core/keys';
import { PAIR_KEY_INFO, SIGNAL_SIGNATURE_LABEL } from '../core/protocol-ids';
import type { SignalPayload } from './envelope';

/**
 * The signed handshake (docs/sync.md, Key model, slice 2, #256). A device with a certificate signs
 * every offer and answer with its device key. The signature covers the packed session description,
 * which holds the DTLS fingerprint of the link, so it binds the direct link itself: a replayed or
 * forwarded offer opens a link only to the device that signed it. Through the relay, frames are sealed
 * with a pair key that only the two certified devices can derive (S-76f).
 *
 * The certificates live in the account document; this module only asks `SyncIdentity` for them.
 */

export interface DeviceProof {
  sign: CryptoKey;
  agree: CryptoKey;
}

export interface PeerKeys {
  sign: PublicKeyJwk;
  agree: PublicKeyJwk;
}

export interface SyncIdentity {
  /** This device's private keys, while it holds a valid certificate. */
  own(): DeviceProof | undefined;
  /** A device's certified public keys; undefined without a valid certificate. */
  peer(peerId: string): PeerKeys | undefined;
  /** The account requires device keys: a peer without proof gets no link and no document. */
  required(): boolean;
}

/** The bytes of an offer or answer that its sender signs. */
function signalBytes(topic: string, p: SignalPayload): Uint8Array {
  return encodeText(`${SIGNAL_SIGNATURE_LABEL}\u0000${JSON.stringify([topic, p.type, p.from, p.to ?? '', p.sid, p.ts, p.code ?? ''])}`);
}

export async function signSignal(proof: DeviceProof, topic: string, payload: SignalPayload): Promise<string> {
  return base64(await sign(proof.sign, signalBytes(topic, payload)));
}

export async function verifySignal(peer: PeerKeys | undefined, topic: string, payload: SignalPayload): Promise<boolean> {
  if (!peer || typeof payload.sig !== 'string') return false;
  try {
    return await verify(peer.sign, signalBytes(topic, payload), unbase64(payload.sig));
  } catch {
    return false;
  }
}

/** The key two certified devices share for their relay frames and addressed signals. */
export function derivePairKey(proof: DeviceProof, peer: PeerKeys, topic: string, a: string, b: string): Promise<CryptoKey> {
  const [x, y] = a < b ? [a, b] : [b, a];
  return pairKey(proof.agree, peer.agree, topic, `${PAIR_KEY_INFO}${x}:${y}`);
}

/** A hello lists the peers whose certificates its sender verified by this prefix of their ids (`vp`). */
export const peerTag = (id: string): string => id.slice(0, 8);
