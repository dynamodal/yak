import { RELAY_SERVICE } from '../core/protocol-ids';
import { isRelayUrl } from './transport-factory';

/** One hour of relay use for one kind of message (`signal` or `link`), from `GET /signal/admin/stats` (worker/index.ts). */
export interface NetworkRow {
  hour: string;
  kind: string;
  rooms: number;
  messages: number;
  bytes: number;
}

export interface NetworkSummary {
  /** Most rooms active in any single hour. */
  peakRooms: number;
  messages: number;
  bytes: number;
  /** Share of bytes carried by relay data links (the fallback), 0 to 1. */
  linkShare: number;
}

export function adminStatsUrl(signalingUrl: string, hours: number): string | undefined {
  const url = signalingUrl.trim();
  if (!isRelayUrl(url)) return undefined;
  return url.replace(/^ws(s?):\/\//i, (_, s: string) => `http${s}://`).replace(/\/+$/, '') + `/admin/stats?hours=${hours}`;
}

export type NetworkResult = { ok: true; rows: NetworkRow[] } | { ok: false; reason: 'key' | 'off' | 'failed' };

export async function fetchNetworkStats(signalingUrl: string, key: string, hours = 24, fetchImpl: typeof fetch = fetch): Promise<NetworkResult> {
  const url = adminStatsUrl(signalingUrl, hours);
  if (!url) return { ok: false, reason: 'off' };
  try {
    const response = await fetchImpl(url, { cache: 'no-store', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (response.status === 401) return { ok: false, reason: 'key' };
    if (response.status === 404) return { ok: false, reason: 'off' };
    const body = (await response.json()) as { service?: unknown; rows?: unknown };
    if (!response.ok || body.service !== RELAY_SERVICE || !Array.isArray(body.rows)) return { ok: false, reason: 'failed' };
    const rows = (body.rows as Record<string, unknown>[]).map((r) => ({
      hour: String(r.hour ?? ''),
      kind: String(r.kind ?? ''),
      rooms: Number(r.rooms) || 0,
      messages: Number(r.messages) || 0,
      bytes: Number(r.bytes) || 0,
    }));
    return { ok: true, rows };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export function summarize(rows: readonly NetworkRow[]): NetworkSummary {
  const perHour = new Map<string, number>();
  let messages = 0;
  let bytes = 0;
  let linkBytes = 0;
  for (const r of rows) {
    // Rooms are counted per kind; the larger of the two is the hour's active rooms (a room may use both).
    perHour.set(r.hour, Math.max(perHour.get(r.hour) ?? 0, r.rooms));
    messages += r.messages;
    bytes += r.bytes;
    if (r.kind === 'link') linkBytes += r.bytes;
  }
  return { peakRooms: Math.max(0, ...perHour.values()), messages, bytes, linkShare: bytes > 0 ? linkBytes / bytes : 0 };
}

/** One UTC day's totals from `GET /signal/admin/usage` (counts only). */
export interface UsageDay {
  day: string;
  used: number;
  accounts: number;
  devices: number;
  shares: number;
  invites: number;
  linkPairs: number;
  messages: number;
}

/** The relay's own estimate of today's requests and who used it, from `RelayBudget` (worker/index.ts, #109). */
export interface RelayUsage {
  /** The relay's clock, ms since the epoch. */
  now: number;
  used: number;
  limit: number;
  linksOffAt: number;
  planLimit: number;
  resetsAt: number;
  requestsPerHour: { today: number[]; yesterday: number[] };
  messagesPerHour: { today: number[]; yesterday: number[] };
  rooms: { accounts: number; shares: number; invites: number; other: number };
  devicesToday: number;
  accountsNow: number;
  devicesNow: number;
  linksNow: number;
  linkPairsToday: number;
  history: UsageDay[];
}

export type UsageResult = { ok: true; usage: RelayUsage } | { ok: false; reason: 'key' | 'off' | 'failed' };

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const hours = (v: unknown): number[] => {
  const list = Array.isArray(v) ? v.map(n) : [];
  return Array.from({ length: 24 }, (_, i) => list[i] ?? 0);
};

export async function fetchRelayUsage(signalingUrl: string, key: string, fetchImpl: typeof fetch = fetch): Promise<UsageResult> {
  const url = adminStatsUrl(signalingUrl, 24)?.replace(/\/admin\/stats\?.*$/, '/admin/usage');
  if (!url) return { ok: false, reason: 'off' };
  try {
    const response = await fetchImpl(url, { cache: 'no-store', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (response.status === 401) return { ok: false, reason: 'key' };
    if (response.status === 404) return { ok: false, reason: 'off' };
    const b = (await response.json()) as Record<string, unknown>;
    if (!response.ok || b.service !== RELAY_SERVICE) return { ok: false, reason: 'failed' };
    const pair = (v: unknown): { today: number[]; yesterday: number[] } => {
      const o = (v ?? {}) as Record<string, unknown>;
      return { today: hours(o.today), yesterday: hours(o.yesterday) };
    };
    const rooms = (b.rooms ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      usage: {
        now: n(b.now) || Date.now(),
        used: n(b.used),
        limit: n(b.limit),
        linksOffAt: n(b.linksOffAt),
        planLimit: n(b.planLimit),
        resetsAt: n(b.resetsAt),
        requestsPerHour: pair(b.requestsPerHour),
        messagesPerHour: pair(b.messagesPerHour),
        rooms: { accounts: n(rooms.accounts), shares: n(rooms.shares), invites: n(rooms.invites), other: n(rooms.other) },
        devicesToday: n(b.devicesToday),
        accountsNow: n(b.accountsNow),
        devicesNow: n(b.devicesNow),
        linksNow: n(b.linksNow),
        linkPairsToday: n(b.linkPairsToday),
        history: (Array.isArray(b.history) ? b.history : []).map((d: Record<string, unknown>) => ({
          day: String(d.day ?? ''),
          used: n(d.used),
          accounts: n(d.accounts),
          devices: n(d.devices),
          shares: n(d.shares),
          invites: n(d.invites),
          linkPairs: n(d.linkPairs),
          messages: n(d.messages),
        })),
      },
    };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** The last 24 hours, oldest first, ending with the current UTC hour. */
export function last24(perHour: { today: number[]; yesterday: number[] }, now: number): number[] {
  const h = new Date(now).getUTCHours();
  return [...perHour.yesterday.slice(h + 1), ...perHour.today.slice(0, h + 1)];
}

/**
 * Where today's count is heading by UTC midnight: what is used, plus the pace of the last three hours
 * (the current one in part) for the hours left. Early in the day the whole day so far sets the pace.
 */
export function projectDay(used: number, today: readonly number[], now: number): number {
  const d = new Date(now);
  const h = d.getUTCHours();
  const intoHour = (d.getUTCMinutes() * 60 + d.getUTCSeconds()) / 3600;
  const from = Math.max(0, h - 2);
  const window = h - from + intoHour;
  const recent = today.slice(from, h + 1).reduce((a, b) => a + b, 0);
  const elapsed = h + intoHour;
  const rate = window >= 0.5 ? recent / window : elapsed > 0 ? used / elapsed : 0;
  return Math.round(used + rate * (24 - elapsed));
}
