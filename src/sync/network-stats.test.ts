import { describe, expect, it } from 'vitest';
import { adminStatsUrl, fetchNetworkStats, fetchRelayUsage, last24, projectDay, summarize } from './network-stats';

const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe('network stats', () => {
  it('builds the admin URL for a relay only', () => {
    expect(adminStatsUrl('wss://yak.example/signal', 6)).toBe('https://yak.example/signal/admin/stats?hours=6');
    expect(adminStatsUrl('https://ntfy.sh', 6)).toBeUndefined();
  });

  it('sends the key as a bearer token and reads rows', async () => {
    let auth = '';
    const impl = (async (_u: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization ?? '';
      return new Response(JSON.stringify({ service: 'yak-relay', rows: [{ hour: 'h1', kind: 'signal', rooms: 2, messages: 10, bytes: 100 }] }));
    }) as unknown as typeof fetch;
    const result = await fetchNetworkStats('wss://x.example/signal', 'secret', 24, impl);
    expect(auth).toBe('Bearer secret');
    expect(result.ok && result.rows[0]?.rooms).toBe(2);
  });

  it('tells a wrong key, a relay without stats and a failure apart', async () => {
    expect(await fetchNetworkStats('wss://x/signal', 'k', 24, reply(401, {}))).toEqual({ ok: false, reason: 'key' });
    expect(await fetchNetworkStats('wss://x/signal', 'k', 24, reply(404, {}))).toEqual({ ok: false, reason: 'off' });
    expect(await fetchNetworkStats('wss://x/signal', 'k', 24, reply(502, { error: 'x' }))).toEqual({ ok: false, reason: 'failed' });
  });

  it('summarizes peak rooms, totals and the share carried by links', () => {
    const s = summarize([
      { hour: 'h1', kind: 'signal', rooms: 2, messages: 10, bytes: 100 },
      { hour: 'h1', kind: 'link', rooms: 1, messages: 5, bytes: 300 },
      { hour: 'h2', kind: 'signal', rooms: 3, messages: 1, bytes: 100 },
    ]);
    expect(s).toEqual({ peakRooms: 3, messages: 16, bytes: 500, linkShare: 0.6 });
  });
});

describe('relay usage (#109)', () => {
  const at = (h: number, m = 0): number => Date.UTC(2026, 9, 30, h, m);

  it('asks admin/usage with the key and reads the counts', async () => {
    let url = '';
    const impl = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ service: 'yak-relay', now: at(12), used: 1200, limit: 50000, linksOffAt: 40000, planLimit: 100000, requestsPerHour: { today: [1, 2], yesterday: [] }, rooms: { accounts: 3, shares: 1 }, devicesToday: 7, history: [{ day: '2026-10-29', used: 900, accounts: 2 }] }));
    }) as unknown as typeof fetch;
    const r = await fetchRelayUsage('wss://yak.example/signal', 'k', impl);
    expect(url).toBe('https://yak.example/signal/admin/usage');
    expect(r.ok && r.usage.rooms).toEqual({ accounts: 3, shares: 1, invites: 0, other: 0 });
    expect(r.ok && r.usage.requestsPerHour.today).toHaveLength(24);
    expect(r.ok && r.usage.history[0]?.devices).toBe(0);
    expect(await fetchRelayUsage('wss://yak.example/signal', 'k', reply(401, {}))).toEqual({ ok: false, reason: 'key' });
    expect(await fetchRelayUsage('https://ntfy.sh', 'k', reply(200, {}))).toEqual({ ok: false, reason: 'off' });
  });

  it('shows the last 24 hours ending with the current one', () => {
    const today = Array.from({ length: 24 }, (_, i) => 100 + i);
    const yesterday = Array.from({ length: 24 }, (_, i) => i);
    const w = last24({ today, yesterday }, at(2, 30));
    expect(w).toHaveLength(24);
    expect(w[0]).toBe(3);
    expect(w.slice(-3)).toEqual([100, 101, 102]);
  });

  it('projects the day from the last three hours', () => {
    const today = Array.from({ length: 24 }, () => 0);
    today[9] = 1000;
    today[10] = 1000;
    today[11] = 1000;
    today[12] = 500;
    // 12:30: hours 10 to 12 hold 2500 in 2.5 hours = 1000 an hour; 11.5 hours left.
    expect(projectDay(5000, today, at(12, 30))).toBe(5000 + 1000 * 11.5);
    // Just after midnight the day so far sets the pace.
    expect(projectDay(0, Array.from({ length: 24 }, () => 0), at(0, 5))).toBe(0);
  });
});
