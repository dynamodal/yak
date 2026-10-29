import { APP_NAME } from '../constants';
import { FROM_EARLIER_VERSION, LEGACY, QR_PREFIX } from '../core/protocol-ids';
import { normalizeSecret } from '../sync/pairing-secret';
import { defaultSignalingUrl } from '../sync/transport-factory';

/**
 * What the pairing QR code carries: `yak:pair?v=1&s=<secret without dashes>[&sig=<url>]`.
 * The `sig` parameter is present only when the signaling server is not the default one.
 */
const PREFIX = QR_PREFIX;

export interface PairingPayload {
  /** Normalized secret, 28 characters without dashes. */
  secret: string;
  /** Signaling server named by the QR code; undefined means "the default". */
  signalingUrl?: string;
}

export function encodePairingPayload(secret: string, signalingUrl?: string): string {
  const params = new URLSearchParams({ v: '1', s: normalizeSecret(secret) });
  const sig = signalingUrl?.trim();
  if (sig && sig.replace(/\/+$/, '') !== defaultSignalingUrl()) params.set('sig', sig);
  return PREFIX + params.toString();
}

/** Parse and validate scanned text. Throws a message fit for the user when it is not a ${APP_NAME} pairing code. */
export function parsePairingPayload(text: string): PairingPayload {
  const trimmed = text.trim();
  if (trimmed.startsWith(LEGACY.qrPrefix)) throw new Error(`That QR code is ${FROM_EARLIER_VERSION}. Pair again with a new code.`);
  if (!trimmed.startsWith(PREFIX)) throw new Error(`That QR code is not a ${APP_NAME} pairing code`);
  const params = new URLSearchParams(trimmed.slice(PREFIX.length));
  if (params.get('v') !== '1') throw new Error(`That pairing code is from a different version of ${APP_NAME}`);
  const secret = normalizeSecret(params.get('s') ?? '');
  const sig = params.get('sig');
  if (sig === null) return { secret };
  let url: URL;
  try {
    url = new URL(sig);
  } catch {
    throw new Error('The connection server in that one-time code is not a valid URL');
  }
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) {
    throw new Error('The connection server in that one-time code must be an http(s) or ws(s) URL');
  }
  return { secret, signalingUrl: sig };
}

/** The code in groups of four, `ABCD-EFGH-…` (how it is shown, and what a person types). */
export function groupSecret(secret: string): string {
  const flat = secret.replace(/[\s-]+/g, '');
  return flat.match(/.{1,4}/g)?.join('-') ?? flat;
}

/**
 * A link that carries a one-time code, to send to the new device (option A+, #22): `<this page>#/join/<code>[/<server>]`.
 * The code is not part of what the site's server sees (a fragment is never sent). It is the same code as the QR code
 * carries, so it works once and for 15 minutes; nothing about pairing changes.
 */
export function joinLink(base: string, secret: string, signalingUrl?: string): string {
  const sig = signalingUrl?.trim();
  const parts = [normalizeSecret(secret)];
  if (sig && sig.replace(/\/+$/, '') !== defaultSignalingUrl()) parts.push(sig);
  return base.split('#')[0] + '#/join/' + parts.map(encodeURIComponent).join('/');
}

/**
 * What a person pasted into the one-time code field: the code itself (returns undefined, the caller keeps the text),
 * a join link (`…#/join/<code>`) or the text of the QR code (`yak:pair?…`). Throws a message fit for the user when it is
 * a link or QR text but not a valid one.
 */
export function parseJoinInput(text: string): PairingPayload | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith(PREFIX) || trimmed.startsWith(LEGACY.qrPrefix)) return parsePairingPayload(trimmed);
  const at = trimmed.indexOf('#/join/');
  if (at < 0) return undefined;
  const [code, sig] = trimmed
    .slice(at + '#/join/'.length)
    .split('/')
    .map((p) => decodeURIComponent(p));
  if (!code) throw new Error(`That link has no ${APP_NAME} one-time code`);
  return parsePairingPayload(encodePairingPayload(code, sig));
}
