import { RELAY_SERVICE } from '../core/protocol-ids';
import { isRelayUrl } from './transport-factory';

/** What this account's relay room has carried (worker/index.ts, `GET /signal/<topic>/stats`): counts only. */
export interface RelayStats {
  /** Devices with a signaling socket open now. */
  devices: number;
  /** Data links open now (relay fallback). */
  links: number;
  hour: { messages: number; bytes: number };
  day: { messages: number; bytes: number };
  /** Unix seconds of the last relayed message, if any. */
  lastActivity?: number;
  /** The relay's totals across every account (#109); absent from an older Worker. */
  relay?: RelayTotals;
}

/** Counts across the whole relay, shown to every user (#109); never one room's. */
export interface RelayTotals {
  accountsNow: number;
  devicesNow: number;
  accountsToday: number;
  devicesToday: number;
  sharesToday: number;
  /** Today's share of the relay's daily allowance, 0 to 1. */
  usedShare: number;
  /** Relayed messages per hour, the last 24 hours, oldest first. */
  messagesPerHour: number[];
}

function totals(v: unknown): RelayTotals | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const perHour = Array.isArray(o.messagesPerHour) ? o.messagesPerHour.slice(-24).map(num) : [];
  return {
    accountsNow: num(o.accountsNow),
    devicesNow: num(o.devicesNow),
    accountsToday: num(o.accountsToday),
    devicesToday: num(o.devicesToday),
    sharesToday: num(o.sharesToday),
    usedShare: Math.min(1, num(o.usedShare)),
    messagesPerHour: perHour,
  };
}

/** `wss://host/signal` → `https://host/signal/<topic>/stats`; undefined for ntfy and other non-relay addresses. */
export function statsUrl(signalingUrl: string, topic: string): string | undefined {
  const url = signalingUrl.trim();
  if (!isRelayUrl(url)) return undefined;
  return url.replace(/^ws(s?):\/\//i, (_, s: string) => `http${s}://`).replace(/\/+$/, '') + `/${encodeURIComponent(topic)}/stats`;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const part = (v: unknown): { messages: number; bytes: number } => {
  const o = (v ?? {}) as { messages?: unknown; bytes?: unknown };
  return { messages: num(o.messages), bytes: num(o.bytes) };
};

/** The room's counts, or undefined when the server is not our relay or does not answer. */
export async function fetchRelayStats(signalingUrl: string, topic: string, fetchImpl: typeof fetch = fetch): Promise<RelayStats | undefined> {
  const url = statsUrl(signalingUrl, topic);
  if (!url) return undefined;
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || body.service !== RELAY_SERVICE) return undefined;
    const relay = totals(body.relay);
    return {
      ...(relay ? { relay } : {}),
      devices: num(body.devices),
      links: num(body.links),
      hour: part(body.hour),
      day: part(body.day),
      ...(typeof body.lastActivity === 'number' ? { lastActivity: body.lastActivity } : {}),
    };
  } catch {
    return undefined;
  }
}

function bytesText(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Relay: 3 devices connected · 420 messages today (35 KB)". */
export function relayStatsText(s: RelayStats): string {
  return `Relay: ${plural(s.devices, 'device', 'devices')} connected · ${plural(s.day.messages, 'message', 'messages')} today (${bytesText(s.day.bytes)})`;
}

/** Longer lines for a details panel. */
export function relayStatsDetails(s: RelayStats, locale?: string): string[] {
  const lines = [
    `${plural(s.devices, 'device', 'devices')} connected now, ${plural(s.links, 'data link', 'data links')} open`,
    `Last hour: ${plural(s.hour.messages, 'message', 'messages')}, ${bytesText(s.hour.bytes)}`,
    `Last 24 hours: ${plural(s.day.messages, 'message', 'messages')}, ${bytesText(s.day.bytes)}`,
  ];
  if (s.lastActivity) lines.push(`Last activity: ${new Date(s.lastActivity * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`);
  return lines;
}

/** The relay's totals for the details panel: who uses it now and today, and how much of the day's allowance is gone. */
export function relayTotalsLines(t: RelayTotals): string[] {
  return [
    `Everyone on the relay now: ${plural(t.accountsNow, 'account', 'accounts')}, ${plural(t.devicesNow, 'device', 'devices')}`,
    `Today: ${plural(t.accountsToday, 'account', 'accounts')}, ${plural(t.devicesToday, 'device', 'devices')}, ${plural(t.sharesToday, 'shared space', 'shared spaces')}`,
    `Relay today: ${Math.round(t.usedShare * 100)}% of the shared daily allowance`,
  ];
}

/** Said only when the relay is busy (half its allowance or more); direct sync never depends on it. */
export function relayBusyText(t: RelayTotals): string | undefined {
  if (t.usedShare >= 1) return "The relay has used today's shared allowance; direct sync is not affected.";
  if (t.usedShare >= 0.8) return "The relay has used over 80% of today's shared allowance; new relay links wait until it resets. Direct sync is not affected.";
  if (t.usedShare >= 0.5) return "The relay has used over half of today's shared allowance; direct sync is not affected.";
  return undefined;
}
