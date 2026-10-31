import { APP_NAME } from '../constants';
import { FROM_EARLIER_VERSION, LEGACY, SYNC_CODE_PREFIX } from '../core/protocol-ids';
/**
 * Packs a WebRTC session description into one short, copy-pasteable string (later a QR code).
 *
 * Descriptions travel through the sealed signaling mailbox (8 KiB a message). UDP host candidates
 * (local addresses) and server-reflexive ones (the public address a STUN server saw) are kept, so
 * devices on one network and on different networks can both connect (#110). TCP, relay,
 * link-local and carrier-grade-NAT (VPN, Tailscale) host candidates only add bytes and failed checks.
 */

type SignalKind = 'offer' | 'answer';

export interface Signal {
  kind: SignalKind;
  sdp: string;
}

const PREFIX = SYNC_CODE_PREFIX;

/** IPv4 addresses that cannot be reached on a home or office LAN: link-local and 100.64.0.0/10. */
function isUnusableHost(address: string): boolean {
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(address);
  if (!m) return false;
  const first = Number(m[1]);
  const second = Number(m[2]);
  if (first === 169 && second === 254) return true;
  return first === 100 && second >= 64 && second <= 127;
}

/** Keep UDP host candidates (including mDNS `.local` names) and UDP server-reflexive ones; drop everything else. */
export function trimSdp(sdp: string): string {
  const lines = sdp.split(/\r?\n/);
  const kept = lines.filter((line) => {
    if (!line.startsWith('a=candidate:')) return true;
    const lower = line.toLowerCase();
    if (!/ udp /.test(lower)) return false;
    if (/ typ srflx\b/.test(lower)) return true;
    if (!/ typ host\b/.test(lower)) return false;
    if (/ fe80:/.test(lower)) return false;
    // a=candidate:<foundation> <component> <transport> <priority> <address> <port> typ host ...
    const address = line.split(' ')[4] ?? '';
    return !isUnusableHost(address);
  });
  return kept.join('\r\n');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeSignal(signal: Signal): Promise<string> {
  const payload = JSON.stringify({ k: signal.kind === 'offer' ? 'o' : 'a', s: trimSdp(signal.sdp) });
  const compressed = await pipe(new TextEncoder().encode(payload), new CompressionStream('deflate-raw'));
  return PREFIX + toBase64Url(compressed);
}

export async function decodeSignal(text: string): Promise<Signal> {
  const trimmed = text.trim().replace(/\s+/g, '');
  if (trimmed.startsWith(LEGACY.syncCodePrefix)) throw new Error(`That sync code is ${FROM_EARLIER_VERSION}. Make a new one.`);
  if (!trimmed.startsWith(PREFIX)) throw new Error(`Not a ${APP_NAME} pairing code (wrong prefix)`);
  let parsed: unknown;
  try {
    const bytes = await pipe(fromBase64Url(trimmed.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Pairing code is damaged or incomplete');
  }
  const obj = parsed as { k?: unknown; s?: unknown };
  if ((obj.k !== 'o' && obj.k !== 'a') || typeof obj.s !== 'string') {
    throw new Error('Pairing code has an unexpected shape');
  }
  return { kind: obj.k === 'o' ? 'offer' : 'answer', sdp: obj.s };
}
