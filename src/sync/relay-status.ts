import { RELAY_SERVICE } from '../core/protocol-ids';
import { isRelayUrl } from './transport-factory';

/**
 * Why the relay is not working, worked out by asking `GET /signal/status` (worker/index.ts). A
 * browser WebSocket failure carries no reason, but this plain request can tell Yak's own
 * limits from Cloudflare refusing us: only our Worker answers with the `yak-relay` marker.
 */
export type RelayDiagnosis =
  /** Our Worker answered: its budget for today is spent (`links` = only data links are refused). */
  | { kind: 'ours-limited'; scope: 'all' | 'links'; resetsAt?: number }
  /** Our Worker answered and is fine; it refused this device (the address limit or the Origin check). */
  | { kind: 'ours-refused'; originAllowed?: boolean }
  /** Something else answered (an error page, a 5xx): Cloudflare's own limit or an outage. */
  | { kind: 'cloudflare' }
  /** No answer at all, though the device is online. */
  | { kind: 'unreachable' }
  | { kind: 'offline' };

/** `wss://host/signal` → `https://host/signal/status`; undefined for ntfy and other non-relay addresses. */
export function statusUrl(signalingUrl: string): string | undefined {
  const url = signalingUrl.trim();
  if (!isRelayUrl(url)) return undefined;
  return url.replace(/^ws(s?):\/\//i, (_, s: string) => `http${s}://`).replace(/\/+$/, '') + '/status';
}

export async function probeRelay(
  signalingUrl: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; online?: boolean } = {},
): Promise<RelayDiagnosis | undefined> {
  const url = statusUrl(signalingUrl);
  if (!url) return undefined;
  const online = options.online ?? (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (!online) return { kind: 'offline' };
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, { cache: 'no-store', signal: AbortSignal.timeout(options.timeoutMs ?? 8000) });
  } catch {
    return { kind: 'unreachable' };
  }
  let body: { service?: unknown; state?: unknown; scope?: unknown; resetsAt?: unknown; originAllowed?: unknown; reason?: unknown } | undefined;
  try {
    body = (await response.json()) as typeof body;
  } catch {
    body = undefined;
  }
  if (body?.service !== RELAY_SERVICE) return { kind: 'cloudflare' };
  if (body.state === 'limited') {
    return {
      kind: 'ours-limited',
      scope: body.scope === 'links' ? 'links' : 'all',
      ...(typeof body.resetsAt === 'number' ? { resetsAt: body.resetsAt } : {}),
    };
  }
  return { kind: 'ours-refused', ...(typeof body.originAllowed === 'boolean' ? { originAllowed: body.originAllowed } : {}) };
}

export interface RelayNoticeInput {
  /** The relay told a link it is over a limit. */
  relayLimit?: 'day' | 'rate' | 'service';
  diagnosis?: RelayDiagnosis;
}

const AFTER = ' Direct sync between devices on the same network is not affected, and the relay is tried again later.';

/** A sentence for the Devices page saying which limit was hit, or nothing when the relay is fine. */
export function relayNotice(input: RelayNoticeInput, locale?: string): string | undefined {
  const d = input.diagnosis;
  if (d?.kind === 'ours-limited' || input.relayLimit === 'service') {
    const at = d?.kind === 'ours-limited' && d.resetsAt ? new Date(d.resetsAt * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : undefined;
    const part = d?.kind === 'ours-limited' && d.scope === 'links' ? 'passing changes through' : 'using';
    return `Yak's relay has used its daily allowance for all users, so ${part} the relay is paused${at ? ` until about ${at}` : ' until tomorrow (UTC)'}.${AFTER}`;
  }
  if (input.relayLimit === 'day') return `Your account used its daily data allowance on the relay.${AFTER}`;
  if (input.relayLimit === 'rate') return `Changes were sent through the relay too fast, so it is paused for a moment.${AFTER}`;
  if (!d) return undefined;
  switch (d.kind) {
    case 'ours-refused':
      return d.originAllowed === false
        ? `The relay does not accept connections from this page's address.${AFTER}`
        : `The relay turned this connection away, usually because this network opened too many connections, in a minute or in a day (many devices behind one address add up).${AFTER}`;
    case 'cloudflare':
      return `Cloudflare, which hosts the relay, is refusing requests (its own daily quota or an outage), not Yak.${AFTER}`;
    case 'unreachable':
      return `The relay cannot be reached from this network (Cloudflare or your connection).${AFTER}`;
    default:
      return undefined;
  }
}
