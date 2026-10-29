import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startMockRelay, type MockRelay } from '../../scripts/mock-relay.mjs';
import { RateLimitedError, type InboxMessage } from './signaling';
import { MAX_RELAY_MESSAGE_BYTES, toWebSocketUrl, WebSocketTransport, type WebSocketTransportOptions } from './signaling-ws';

let relay: MockRelay;
const stops: (() => void)[] = [];
const topic = (): string => `yk-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')}`;

beforeEach(async () => {
  relay = await startMockRelay();
});

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await relay.close();
});

async function waitFor(condition: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const fast: WebSocketTransportOptions = { retryMs: 20, maxRetryMs: 60, keepaliveMs: 0 };

interface Watch {
  messages: InboxMessage[];
  statuses: string[];
  activity: (number | undefined)[];
}

function watch(transport: WebSocketTransport, mailbox: string): Watch {
  const w: Watch = { messages: [], statuses: [], activity: [] };
  stops.push(
    transport.subscribe(mailbox, {
      onMessage: (m) => w.messages.push(m),
      onStatus: (s) => w.statuses.push(s),
      onActivity: (t) => w.activity.push(t),
    }),
  );
  return w;
}

describe('WebSocketTransport', () => {
  it('delivers a message to the other device, never echoes it, and stamps server time', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const b = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const t = topic();
    const wa = watch(a, t);
    const wb = watch(b, t);
    await waitFor(() => wa.statuses.includes('connected') && wb.statuses.includes('connected'), 2000, 'both connected');
    await a.publish(t, 'hello from a');
    await waitFor(() => wb.messages.length === 1, 2000, 'delivery');
    expect(wb.messages[0]?.message).toBe('hello from a');
    expect(wb.messages[0]?.id).toBeTruthy();
    expect(Math.abs((wb.messages[0]?.time ?? 0) - Date.now() / 1000)).toBeLessThan(5);
    await new Promise((r) => setTimeout(r, 100));
    expect(wa.messages).toEqual([]);
    // Every frame, including the server's `open` event, reports server time.
    expect(wa.activity.some((time) => typeof time === 'number' && time > 1_700_000_000)).toBe(true);
  });

  it('keeps rooms separate', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const b = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const [t1, t2] = [topic(), topic()];
    watch(a, t1);
    const w2 = watch(b, t2);
    await waitFor(() => relay.openSockets() === 2, 2000, 'two rooms');
    await a.publish(t1, 'only room one');
    await new Promise((r) => setTimeout(r, 100));
    expect(w2.messages).toEqual([]);
  });

  it('shares one socket per mailbox between publish and subscribe', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const t = topic();
    watch(a, t);
    await waitFor(() => relay.openSockets() === 1, 2000, 'connected');
    await a.publish(t, 'one');
    await a.publish(t, 'two');
    expect(relay.state.connections).toBe(1);
  });

  it('queues publishes made before the socket is open and sends them in order', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const b = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const t = topic();
    const wb = watch(b, t);
    await waitFor(() => wb.statuses.includes('connected'), 2000, 'receiver connected');
    // No subscription and no connection yet on `a`: both publishes wait for the socket.
    const sent = Promise.all([a.publish(t, 'first'), a.publish(t, 'second')]);
    await sent;
    await waitFor(() => wb.messages.length === 2, 2000, 'both delivered');
    expect(wb.messages.map((m) => m.message)).toEqual(['first', 'second']);
  });

  it('reconnects after the relay drops the socket and keeps delivering', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const b = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const t = topic();
    const wa = watch(a, t);
    const wb = watch(b, t);
    await waitFor(() => relay.openSockets() === 2, 2000, 'both connected');
    relay.dropAll();
    await waitFor(() => wa.statuses.includes('disconnected') && wb.statuses.includes('disconnected'), 2000, 'drop seen');
    await waitFor(() => relay.openSockets() === 2, 3000, 'both reconnected');
    await waitFor(() => wa.statuses.filter((s) => s === 'connected').length === 2, 2000, 'connected again');
    await a.publish(t, 'after the drop');
    await waitFor(() => wb.messages.length === 1, 2000, 'delivery after reconnect');
    expect(wb.messages[0]?.message).toBe('after the drop');
  });

  it('a publish made while the connection is down is sent when it returns', async () => {
    // The sender retries more slowly than the receiver, so the receiver is back first: the relay
    // keeps nothing, so a message sent to an empty room would be lost by design.
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast, retryMs: 300, maxRetryMs: 300 });
    const b = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const t = topic();
    const wa = watch(a, t);
    const wb = watch(b, t);
    await waitFor(() => relay.openSockets() === 2, 2000, 'both connected');
    relay.dropAll();
    await waitFor(() => wa.statuses.includes('disconnected'), 2000, 'drop seen');
    const pending = a.publish(t, 'while down');
    await pending;
    await waitFor(() => wb.messages.length === 1, 3000, 'delivered after reconnect');
  });

  it('unsubscribing closes the socket; subscribing again opens a fresh one', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const t = topic();
    const stop = a.subscribe(t, { onMessage: () => {} });
    await waitFor(() => relay.openSockets() === 1, 2000, 'open');
    stop();
    await waitFor(() => relay.openSockets() === 0, 2000, 'closed');
    const w = watch(a, t);
    await waitFor(() => w.statuses.includes('connected'), 2000, 'reconnected');
    expect(relay.state.connections).toBe(2);
  });

  it('does not reconnect after unsubscribe', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const stop = a.subscribe(topic(), { onMessage: () => {} });
    await waitFor(() => relay.openSockets() === 1, 2000, 'open');
    stop();
    await new Promise((r) => setTimeout(r, 200));
    expect(relay.state.connections).toBe(1);
  });

  it('rejects an oversized message on the client without sending it', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    await expect(a.publish(topic(), 'x'.repeat(MAX_RELAY_MESSAGE_BYTES + 1))).rejects.toThrow(/larger than/);
    // Multi-byte characters count as bytes, not characters.
    await expect(a.publish(topic(), '€'.repeat(3000))).rejects.toThrow(/larger than/);
    expect(relay.state.connections).toBe(0);
  });

  it('the relay closes a socket that sends an oversized message', async () => {
    const t = topic();
    const raw = new WebSocket(`${relay.url}/${t}`);
    const closed = new Promise<number>((resolve) => raw.addEventListener('close', (e) => resolve(e.code)));
    await new Promise((resolve) => raw.addEventListener('open', resolve, { once: true }));
    raw.send('x'.repeat(MAX_RELAY_MESSAGE_BYTES + 1));
    expect(await closed).toBe(1009);
  });

  it('a malformed topic is refused and never reports connected', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const w = watch(a, 'not-a-valid-topic');
    await waitFor(() => relay.state.rejected >= 2, 3000, 'two refused attempts');
    expect(w.statuses).not.toContain('connected');
    expect(w.statuses).toContain('disconnected');
  });

  it('answers a keepalive ping and reports it as activity', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast, keepaliveMs: 30 });
    const w = watch(a, topic());
    await waitFor(() => relay.state.pings >= 2, 2000, 'pings');
    const before = w.activity.length;
    await waitFor(() => w.activity.length > before, 2000, 'pong activity');
  });

  it('abandons a socket that stops answering pings and reconnects', async () => {
    const a = new WebSocketTransport({ baseUrl: relay.url, ...fast, keepaliveMs: 30, pongTimeoutMs: 60 });
    const w = watch(a, topic());
    await waitFor(() => w.statuses.includes('connected'), 2000, 'connected');
    relay.state.silent = true;
    await waitFor(() => w.statuses.includes('disconnected'), 2000, 'dead socket detected');
    relay.state.silent = false;
    await waitFor(() => w.statuses.filter((s) => s === 'connected').length === 2, 3000, 'reconnected');
  });

  it('retries with backoff while the relay is unreachable, then connects when it returns', async () => {
    const port = Number(new URL(relay.httpUrl).port);
    await relay.close();
    const a = new WebSocketTransport({ baseUrl: `ws://127.0.0.1:${port}/signal`, ...fast });
    const w = watch(a, topic());
    await waitFor(() => w.statuses.filter((s) => s === 'disconnected').length >= 2, 3000, 'repeated failures');
    relay = await startMockRelay({ port });
    await waitFor(() => w.statuses.includes('connected'), 3000, 'connected once the relay is back');
  });

  it('reports a WebSocket that cannot be created as disconnected instead of throwing', async () => {
    const broken = new WebSocketTransport({
      baseUrl: relay.url,
      ...fast,
      publishTimeoutMs: 100,
      WebSocketImpl: class {
        constructor() {
          throw new Error('blocked by policy');
        }
      } as unknown as typeof WebSocket,
    });
    const details: (string | undefined)[] = [];
    stops.push(broken.subscribe(topic(), { onMessage: () => {}, onStatus: (_s, d) => details.push(d) }));
    await waitFor(() => details.length > 0, 1000, 'disconnected');
    expect(details[0]).toMatch(/blocked by policy/);
    await expect(broken.publish(topic(), 'x')).rejects.toThrow();
  });
});

describe('relay refusals (close codes 4429 and 4430)', () => {
  it('reports a per-minute refusal, fails waiting publishes with the retry time, and waits before trying again', async () => {
    relay.refuse('rate', { retry: 1, count: 1 });
    const transport = new WebSocketTransport({ baseUrl: relay.url, ...fast, publishTimeoutMs: 5000 });
    const t = topic();
    const refusals: unknown[] = [];
    const statuses: string[] = [];
    stops.push(transport.subscribe(t, { onMessage: () => {}, onStatus: (s) => statuses.push(s), onRefused: (r) => refusals.push(r) }));
    await waitFor(() => refusals.length === 1, 2000, 'refusal');
    expect(refusals[0]).toMatchObject({ kind: 'rate', retryMs: 5000 });
    expect(statuses).toContain('disconnected');
    // It does not retry at the short backoff (20 ms) but only after the relay's retry time.
    const connections = relay.state.connections;
    await new Promise((r) => setTimeout(r, 300));
    expect(relay.state.connections).toBe(connections);
  });

  it('a publish waiting when the refusal arrives fails with RateLimitedError carrying the retry time', async () => {
    // A socket that is refused before it ever opens (some runtimes), so the publish is still queued.
    class Refused {
      onclose: ((e: { code: number; reason: string }) => void) | null = null;
      constructor() {
        setTimeout(() => this.onclose?.({ code: 4430, reason: `day scope=topics reset=${Math.floor(Date.now() / 1000) + 600}` }), 5);
      }
      close(): void {}
    }
    const transport = new WebSocketTransport({ baseUrl: relay.url, ...fast, publishTimeoutMs: 5000, WebSocketImpl: Refused as unknown as typeof WebSocket });
    const err = await transport.publish(topic(), 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterMs).toBeGreaterThan(60_000);
  });

  it('a plain drop is not a refusal: it reconnects at the normal backoff', async () => {
    const transport = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const t = topic();
    const refusals: unknown[] = [];
    const w: Watch = { messages: [], statuses: [], activity: [] };
    stops.push(transport.subscribe(t, { onMessage: () => {}, onStatus: (s) => w.statuses.push(s), onRefused: (r) => refusals.push(r) }));
    await waitFor(() => w.statuses.includes('connected'), 2000, 'connected');
    relay.dropAll();
    await waitFor(() => w.statuses.filter((s) => s === 'connected').length === 2, 3000, 'reconnected');
    expect(refusals).toEqual([]);
  });

  it('a close with another application code (4000) is a plain drop too', async () => {
    const transport = new WebSocketTransport({ baseUrl: relay.url, ...fast });
    const t = topic();
    const refusals: unknown[] = [];
    const w: Watch = { messages: [], statuses: [], activity: [] };
    stops.push(transport.subscribe(t, { onMessage: () => {}, onStatus: (s) => w.statuses.push(s), onRefused: (r) => refusals.push(r) }));
    await waitFor(() => w.statuses.includes('connected'), 2000, 'connected');
    // Sixteen more sockets in the room make the relay close the oldest with 4000.
    const extra = Array.from({ length: 16 }, () => new WebSocketTransport({ baseUrl: relay.url, ...fast }));
    extra.forEach((e) => stops.push(e.subscribe(t, { onMessage: () => {} })));
    await waitFor(() => w.statuses.filter((s) => s === 'disconnected').length >= 1, 3000, 'replaced');
    expect(refusals).toEqual([]);
  });
});

describe('toWebSocketUrl', () => {
  it('maps http(s) to ws(s) and trims trailing slashes', () => {
    expect(toWebSocketUrl('https://example.com/signal/')).toBe('wss://example.com/signal');
    expect(toWebSocketUrl('http://localhost:8787/signal')).toBe('ws://localhost:8787/signal');
    expect(toWebSocketUrl('wss://example.com/signal')).toBe('wss://example.com/signal');
  });
});
