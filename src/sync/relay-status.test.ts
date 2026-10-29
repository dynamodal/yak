import { describe, expect, it } from 'vitest';
import { probeRelay, relayNotice, statusUrl } from './relay-status';

const json = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
const text = (body: string, status: number): typeof fetch => (async () => new Response(body, { status })) as typeof fetch;
const relay = 'wss://example.test/signal';

describe('statusUrl', () => {
  it('turns the relay address into its status address', () => {
    expect(statusUrl('wss://example.test/signal')).toBe('https://example.test/signal/status');
    expect(statusUrl('ws://127.0.0.1:8787/signal/')).toBe('http://127.0.0.1:8787/signal/status');
    expect(statusUrl('https://ntfy.sh')).toBeUndefined();
  });
});

describe('probeRelay', () => {
  it('knows its own budget limit', async () => {
    const d = await probeRelay(relay, { fetchImpl: json({ service: 'yak-relay', state: 'limited', scope: 'links', resetsAt: 1000 }), online: true });
    expect(d).toEqual({ kind: 'ours-limited', scope: 'links', resetsAt: 1000 });
  });
  it('knows its own refusal of this device', async () => {
    expect(await probeRelay(relay, { fetchImpl: json({ service: 'yak-relay', state: 'ok', originAllowed: false }), online: true })).toEqual({ kind: 'ours-refused', originAllowed: false });
    // Fine, and nothing to say about this device: a plain drop, not a limit.
    expect(await probeRelay(relay, { fetchImpl: json({ service: 'yak-relay', state: 'ok' }), online: true })).toEqual({ kind: 'reachable' });
  });
  it('knows an older relay turned the status call itself away (HTTP 429 with the marker)', async () => {
    const limited = (async () => new Response(JSON.stringify({ service: 'yak-relay', error: 'refused', reason: 'address' }), { status: 429, headers: { 'Retry-After': '60' } })) as typeof fetch;
    expect(await probeRelay(relay, { fetchImpl: limited, online: true })).toEqual({ kind: 'ours-refused', retryAfterMs: 60_000 });
    expect(await probeRelay(relay, { fetchImpl: json({ service: 'yak-relay', reason: 'address' }, 429), online: true })).toEqual({ kind: 'ours-refused' });
  });
  it('calls an answer without the marker Cloudflare, whatever its status', async () => {
    expect(await probeRelay(relay, { fetchImpl: text('<html>error code: 1027</html>', 429), online: true })).toEqual({ kind: 'cloudflare' });
    expect(await probeRelay(relay, { fetchImpl: json({ error: 'x' }, 503), online: true })).toEqual({ kind: 'cloudflare' });
  });
  it('tells no answer from being offline', async () => {
    const failing = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    expect(await probeRelay(relay, { fetchImpl: failing, online: true })).toEqual({ kind: 'unreachable' });
    expect(await probeRelay(relay, { fetchImpl: failing, online: false })).toEqual({ kind: 'offline' });
  });
  it('does nothing for ntfy', async () => {
    expect(await probeRelay('https://ntfy.sh', { fetchImpl: json({}), online: true })).toBeUndefined();
  });
});

describe('relayNotice', () => {
  it('says whose limit it is', () => {
    expect(relayNotice({ diagnosis: { kind: 'ours-limited', scope: 'all', resetsAt: 1000 } }, 'en')).toMatch(/Yak's relay has used its daily allowance/);
    expect(relayNotice({ relayLimit: 'service' })).toMatch(/Yak's relay has used its daily allowance/);
    expect(relayNotice({ relayLimit: 'day' })).toMatch(/Your account used its daily data allowance/);
    expect(relayNotice({ relayLimit: 'rate' })).toMatch(/too fast/);
    expect(relayNotice({ diagnosis: { kind: 'cloudflare' } })).toMatch(/Cloudflare, which hosts the relay, is refusing requests/);
    expect(relayNotice({ diagnosis: { kind: 'ours-refused', originAllowed: false } })).toMatch(/does not accept connections from this page/);
    expect(relayNotice({ diagnosis: { kind: 'ours-refused' } })).toMatch(/too many connections/);
    expect(relayNotice({ diagnosis: { kind: 'reachable' } })).toMatch(/cannot be reached right now/);
    expect(relayNotice({ diagnosis: { kind: 'reachable' } })).not.toMatch(/too many|limit/);
    expect(relayNotice({ refusal: { kind: 'rate', retryMs: 60_000 } })).toMatch(/too many connections to the relay in a minute/);
    expect(relayNotice({ refusal: { kind: 'day', scope: 'share', retryMs: 1, resetsAt: 1000 } }, 'en')).toMatch(/daily share.*until about/);
    expect(relayNotice({ refusal: { kind: 'day', scope: 'topics', retryMs: 1 } })).toMatch(/too many different accounts.*until tomorrow/);
    expect(relayNotice({ diagnosis: { kind: 'unreachable' } })).toMatch(/cannot be reached/);
  });
  it('is silent when nothing is wrong or the device is offline', () => {
    expect(relayNotice({})).toBeUndefined();
    expect(relayNotice({ diagnosis: { kind: 'offline' } })).toBeUndefined();
  });
  it('always says direct sync still works', () => {
    for (const input of [{ relayLimit: 'day' as const }, { diagnosis: { kind: 'cloudflare' as const } }]) expect(relayNotice(input)).toMatch(/Direct sync/);
  });
});
