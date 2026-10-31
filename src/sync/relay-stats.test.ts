import { describe, expect, it } from 'vitest';
import { fetchRelayStats, relayBusyText, relayStatsDetails, relayStatsText, relayTotalsLines, statsUrl } from './relay-stats';

const topic = 'yk-' + 'a'.repeat(32);
const json = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe('relay stats', () => {
  it('builds the URL for a relay and none for ntfy', () => {
    expect(statsUrl('wss://yak.example/signal', topic)).toBe(`https://yak.example/signal/${topic}/stats`);
    expect(statsUrl('https://ntfy.sh', topic)).toBeUndefined();
  });

  it('reads our relay\'s answer and refuses anything else', async () => {
    const body = { service: 'yak-relay', devices: 3, links: 1, hour: { messages: 5, bytes: 100 }, day: { messages: 420, bytes: 36000 }, lastActivity: 1760000000 };
    const stats = await fetchRelayStats('wss://x.example/signal', topic, json(body));
    expect(stats?.devices).toBe(3);
    expect(relayStatsText(stats!)).toBe('Relay: 3 devices connected · 420 messages today (35 KB)');
    expect(relayStatsDetails(stats!)).toHaveLength(4);
    expect(await fetchRelayStats('wss://x.example/signal', topic, json({ devices: 1 }))).toBeUndefined();
    expect(await fetchRelayStats('wss://x.example/signal', topic, json(body, 503))).toBeUndefined();
    expect(await fetchRelayStats('wss://x.example/signal', topic, (async () => { throw new Error('x'); }) as typeof fetch)).toBeUndefined();
  });
});

describe('relay totals (#109)', () => {
  const base = { service: 'yak-relay', devices: 2, links: 0, hour: {}, day: {} };
  it('reads the relay-wide totals when the Worker sends them', async () => {
    const relay = { accountsNow: 2, devicesNow: 5, accountsToday: 3, devicesToday: 7, sharesToday: 1, usedShare: 0.62, messagesPerHour: Array.from({ length: 30 }, () => 1) };
    const s = await fetchRelayStats('wss://x.example/signal', topic, json({ ...base, relay }));
    expect(s?.relay?.messagesPerHour).toHaveLength(24);
    expect(relayTotalsLines(s!.relay!)).toEqual([
      'Everyone on the relay now: 2 accounts, 5 devices',
      'Today: 3 accounts, 7 devices, 1 shared space',
      'Relay today: 62% of the shared daily allowance',
    ]);
    expect(relayBusyText(s!.relay!)).toMatch(/over half/);
    expect((await fetchRelayStats('wss://x.example/signal', topic, json(base)))?.relay).toBeUndefined();
  });

  it('says nothing about load below half the allowance', () => {
    const t = { accountsNow: 0, devicesNow: 0, accountsToday: 0, devicesToday: 0, sharesToday: 0, usedShare: 0.49, messagesPerHour: [] };
    expect(relayBusyText(t)).toBeUndefined();
    expect(relayBusyText({ ...t, usedShare: 0.85 })).toMatch(/80%/);
    expect(relayBusyText({ ...t, usedShare: 1 })).toMatch(/used today's/);
  });
});
