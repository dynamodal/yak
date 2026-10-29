import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startMockRelay, type MockRelay } from '../../scripts/mock-relay.mjs';
import { EventLog } from './event-log';
import { deriveKeys, generateSecret, type DerivedKeys } from './pairing-secret';
import { pairTag, PIECE_BYTES, RelayLink } from './relay-link';

let relay: MockRelay;
let keys: DerivedKeys;
const links: RelayLink[] = [];

beforeEach(async () => {
  relay = await startMockRelay();
  keys = await deriveKeys(generateSecret());
});

afterEach(async () => {
  for (const l of links.splice(0)) l.close();
  await relay.close();
});

async function waitFor(condition: () => boolean, timeoutMs = 4000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface End {
  link: RelayLink;
  opens: number;
  closes: string[];
  got: Uint8Array[];
}

function end(self: string, peer: string, key = keys.key, pair?: { key: CryptoKey; only: boolean }): End & { pairFailed: number } {
  const e: End & { pairFailed: number } = { opens: 0, closes: [], got: [], pairFailed: 0, link: undefined as unknown as RelayLink };
  e.link = new RelayLink(
    { baseUrl: relay.url, topic: keys.topic, selfId: self, peerId: peer, key, ...(pair ? { pair } : {}), log: new EventLog(), retryMs: 20, maxRetryMs: 60, keepaliveMs: 0 },
    { onOpen: () => e.opens++, onClose: (r) => e.closes.push(r), onMessage: (d) => e.got.push(d), onPairFailed: () => e.pairFailed++ },
  );
  links.push(e.link);
  e.link.start();
  return e;
}

describe('pairTag', () => {
  it('is the same from both sides and differs per pair', async () => {
    expect(await pairTag('t', 'a', 'b')).toBe(await pairTag('t', 'b', 'a'));
    expect(await pairTag('t', 'a', 'b')).not.toBe(await pairTag('t', 'a', 'c'));
    expect(await pairTag('t', 'a', 'b')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('RelayLink', () => {
  it('opens when both devices are on the relay and carries messages both ways', async () => {
    const a = end('aaa', 'bbb');
    const b = end('bbb', 'aaa');
    await waitFor(() => a.link.open && b.link.open, 4000, 'both open');
    expect(a.opens).toBe(1);
    expect(b.opens).toBe(1);
    a.link.send(new TextEncoder().encode('from a'));
    b.link.send(new TextEncoder().encode('from b'));
    await waitFor(() => a.got.length === 1 && b.got.length === 1, 4000, 'messages');
    expect(new TextDecoder().decode(b.got[0])).toBe('from a');
    expect(new TextDecoder().decode(a.got[0])).toBe('from b');
  });

  it('splits a large message into pieces and joins it again, in order with small ones', async () => {
    const a = end('aaa', 'bbb');
    const b = end('bbb', 'aaa');
    await waitFor(() => a.link.open && b.link.open);
    const big = new Uint8Array(PIECE_BYTES * 3 + 5).map((_, i) => (i * 31) % 251);
    a.link.send(big);
    a.link.send(new TextEncoder().encode('after'));
    await waitFor(() => b.got.length === 2, 6000, 'big message');
    expect(b.got[0]).toEqual(big);
    expect(new TextDecoder().decode(b.got[1])).toBe('after');
    expect(relay.state.linkFrames).toBeGreaterThanOrEqual(5);
  });

  it('does not send plaintext through the relay', async () => {
    const a = end('aaa', 'bbb');
    const b = end('bbb', 'aaa');
    await waitFor(() => a.link.open && b.link.open);
    const seen: Buffer[] = [];
    relay.onFrame = (f: Buffer) => seen.push(f);
    a.link.send(new TextEncoder().encode('secret words'));
    await waitFor(() => b.got.length === 1);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((f) => !f.toString('latin1').includes('secret words'))).toBe(true);
  });

  it('ignores a device with the wrong key', async () => {
    const other = await deriveKeys(generateSecret());
    const a = end('aaa', 'bbb');
    const intruder = end('bbb', 'aaa', other.key);
    await new Promise((r) => setTimeout(r, 300));
    expect(a.link.open).toBe(false);
    expect(intruder.link.open).toBe(false);
  });

  it('reports the other device leaving, and opens again when it returns', async () => {
    const a = end('aaa', 'bbb');
    const b = end('bbb', 'aaa');
    await waitFor(() => a.link.open && b.link.open);
    b.link.close();
    await waitFor(() => a.closes.length === 1, 4000, 'close');
    expect(a.link.open).toBe(false);
    const b2 = end('bbb', 'aaa');
    await waitFor(() => a.link.open && b2.link.open, 4000, 'reopen');
    expect(a.opens).toBe(2);
  });

  it('reconnects after the relay drops its sockets', async () => {
    const a = end('aaa', 'bbb');
    const b = end('bbb', 'aaa');
    await waitFor(() => a.link.open && b.link.open);
    relay.dropAll();
    await waitFor(() => a.closes.length === 1 && b.closes.length === 1, 4000, 'drop seen');
    await waitFor(() => a.link.open && b.link.open, 6000, 'reopen');
  });

  it('reports a limit event, stops, and does not reconnect right away', async () => {
    const limits: string[] = [];
    const a = new RelayLink(
      { baseUrl: relay.url, topic: keys.topic, selfId: 'aaa', peerId: 'bbb', key: keys.key, log: new EventLog(), retryMs: 20, maxRetryMs: 60, keepaliveMs: 0 },
      { onOpen() {}, onClose() {}, onMessage() {}, onLimit: (r) => limits.push(r) },
    );
    links.push(a);
    a.start();
    const b = end('bbb', 'aaa');
    await waitFor(() => a.open && b.link.open);
    // Both link sockets must be registered on the relay, or the limit frame misses one under load.
    await waitFor(() => relay.state.links >= 2, 4000, 'both link sockets on the relay');
    relay.limitLinks('day');
    await waitFor(() => limits.length === 1, 4000, 'limit reported');
    expect(limits).toEqual(['day']);
    expect(a.open).toBe(false);
    const connections = relay.state.links;
    await new Promise((r) => setTimeout(r, 300));
    expect(relay.state.links).toBe(connections);
  });
});

describe('RelayLink refused by the relay (close codes)', () => {
  it('reports the refusal once and waits the relay\'s retry time before connecting again', async () => {
    relay.refuse('rate', { retry: 60 });
    const refusals: unknown[] = [];
    const a = new RelayLink(
      { baseUrl: relay.url, topic: keys.topic, selfId: 'aaa', peerId: 'bbb', key: keys.key, log: new EventLog(), retryMs: 20, maxRetryMs: 60, keepaliveMs: 0 },
      { onOpen() {}, onClose() {}, onMessage() {}, onRefused: (r) => refusals.push(r) },
    );
    links.push(a);
    a.start();
    await waitFor(() => refusals.length === 1, 3000, 'refusal');
    expect(refusals[0]).toMatchObject({ kind: 'rate', retryMs: 60_000 });
    const attempts = relay.state.refused;
    await new Promise((r) => setTimeout(r, 300));
    expect(relay.state.refused).toBe(attempts);
  });

  it('a plain drop is not a refusal and reconnects soon', async () => {
    const refusals: unknown[] = [];
    const a = new RelayLink(
      { baseUrl: relay.url, topic: keys.topic, selfId: 'aaa', peerId: 'bbb', key: keys.key, log: new EventLog(), retryMs: 20, maxRetryMs: 60, keepaliveMs: 0 },
      { onOpen() {}, onClose() {}, onMessage() {}, onRefused: (r) => refusals.push(r) },
    );
    links.push(a);
    a.start();
    await waitFor(() => relay.state.links >= 1);
    relay.dropAll();
    await waitFor(() => relay.state.links >= 2, 3000, 'reconnect');
    expect(refusals).toEqual([]);
  });
});

const aesKey = (): Promise<CryptoKey> => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const text = (d: Uint8Array | undefined): string => new TextDecoder().decode(d);

describe('RelayLink with a pair key (#256)', () => {
  it('carries messages sealed with the pair key, and with `only` refuses the shared key', async () => {
    const pk = await aesKey();
    const a = end('aaa', 'bbb', keys.key, { key: pk, only: true });
    const b = end('bbb', 'aaa', keys.key, { key: pk, only: true });
    await waitFor(() => a.link.open && b.link.open, 4000, 'both open');
    a.link.send(new TextEncoder().encode('pair'));
    await waitFor(() => b.got.length === 1);
    expect(text(b.got[0])).toBe('pair');
    // A device with only the shared key never gets in, and never moves the link off the pair key.
    const c = end('ccc', 'ddd', keys.key, { key: pk, only: true });
    const d = end('ddd', 'ccc');
    await new Promise((r) => setTimeout(r, 300));
    expect(c.link.open).toBe(false);
    expect(d.link.open).toBe(false);
    expect(c.pairFailed + a.pairFailed + b.pairFailed).toBe(0);
    // A device that has the pair key still gets in on that same link afterwards.
    d.link.close();
    const e = end('ddd', 'ccc', keys.key, { key: pk, only: true });
    await waitFor(() => c.link.open && e.link.open, 4000, 'pair-key device in after the refused one');
    c.link.send(new TextEncoder().encode('still pair'));
    await waitFor(() => e.got.length === 1);
    expect(text(e.got[0])).toBe('still pair');
    expect(c.pairFailed).toBe(0);
  });

  it('falls back to the shared key with a device that has no pair key (an older build)', async () => {
    const a = end('aaa', 'bbb', keys.key, { key: await aesKey(), only: false });
    const b = end('bbb', 'aaa');
    await waitFor(() => a.link.open && b.link.open, 15000, 'both open');
    a.link.send(new TextEncoder().encode('to old'));
    b.link.send(new TextEncoder().encode('from old'));
    await waitFor(() => b.got.length === 1 && a.got.length === 1, 10000, 'messages');
    expect(text(b.got[0])).toBe('to old');
    expect(a.pairFailed).toBe(1);
  }, 30000);

  it('a deliberately broken pair key: both ends fall back to the shared key and keep syncing', async () => {
    const a = end('aaa', 'bbb', keys.key, { key: await aesKey(), only: false });
    const b = end('bbb', 'aaa', keys.key, { key: await aesKey(), only: false });
    await waitFor(() => a.link.open && b.link.open, 4000, 'both open');
    a.link.send(new TextEncoder().encode('one'));
    b.link.send(new TextEncoder().encode('two'));
    await waitFor(() => b.got.length === 1 && a.got.length === 1);
    expect([text(b.got[0]), text(a.got[0])]).toEqual(['one', 'two']);
    expect(a.pairFailed + b.pairFailed).toBeGreaterThanOrEqual(1);
  });
});
