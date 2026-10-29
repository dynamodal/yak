import { RELAY_SERVICE } from '../core/protocol-ids';
import type { RelayRefusal } from './relay-refusal';
import { isRelayUrl } from './transport-factory';

/**
 * Why the relay is not working, worked out by asking `GET /signal/status` (worker/index.ts). A
 * browser WebSocket failure carries no reason, but this plain request can tell Yak's own
 * relay from Cloudflare refusing us: only our Worker answers with the `yak-relay` marker. Limits
 * of this network are not guessed from it: the relay names them in a close code (relay-refusal.ts).
 */
export type RelayDiagnosis =
  /** Our Worker answered: its budget for today is spent (`links` = only data links are refused). */
  | { kind: 'ours-limited'; scope: 'all' | 'links'; resetsAt?: number }
  /** Our Worker turned this device away: the status call itself got HTTP 429 (an older relay's way), or the Origin check failed. */
  | { kind: 'ours-refused'; originAllowed?: boolean; retryAfterMs?: number }
  /** Our Worker answered and is fine: the connection dropped for some other reason (network blip, sleep, restart). */
  | { kind: 'reachable' }
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
  if (response.status === 429) {
    const after = Number(response.headers.get('Retry-After'));
    return { kind: 'ours-refused', ...(after > 0 ? { retryAfterMs: Math.min(after * 1000, 5 * 60_000) } : {}) };
  }
  if (body.originAllowed === false) return { kind: 'ours-refused', originAllowed: false };
  return { kind: 'reachable' };
}

export interface RelayNoticeInput {
  /** The relay closed a connection naming a limit of this network. */
  refusal?: RelayRefusal;
  /** The relay told a link it is over a limit. */
  relayLimit?: 'day' | 'rate' | 'service';
  diagnosis?: RelayDiagnosis;
}

const AFTER = ' Direct sync between devices on the same network is not affected, and the relay is tried again later.';

/** A sentence for the Devices page saying which limit was hit, or nothing when the relay is fine. */
export function relayNotice(input: RelayNoticeInput, locale?: string): string | undefined {
  const d = input.diagnosis;
  if (input.refusal) {
    const r = input.refusal;
    if (r.kind === 'rate') return `This network opened too many connections to the relay in a minute (several devices behind one address add up), so it is paused for a moment.${AFTER}`;
    const at = r.resetsAt ? new Date(r.resetsAt * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : undefined;
    const what = r.scope === 'topics' ? 'connected to too many different accounts today' : "used its daily share of Yak's relay";
    return `This network ${what} (many devices behind one address add up), so the relay is paused for it${at ? ` until about ${at}` : ' until tomorrow (UTC)'}.${AFTER}`;
  }
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
        : `The relay turned this connection away, because this network opened too many connections (many devices behind one address add up).${AFTER}`;
    case 'reachable':
      return `The relay cannot be reached right now (the connection dropped, often a network change or sleep); trying again.${AFTER}`;
    case 'cloudflare':
      return `Cloudflare, which hosts the relay, is refusing requests (its own daily quota or an outage), not Yak.${AFTER}`;
    case 'unreachable':
      return `The relay cannot be reached from this network (Cloudflare or your connection).${AFTER}`;
    default:
      return undefined;
  }
}
