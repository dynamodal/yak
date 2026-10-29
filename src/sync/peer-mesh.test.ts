import { afterEach, describe, expect, it } from 'vitest';
import { seal } from './envelope';
import { EventLog } from './event-log';
import type { LinkEndpoint } from './types';
import { deriveKeys, generateSecret, type DerivedKeys } from './pairing-secret';
import { PeerMesh, type RelayEndpoint } from './peer-mesh';
import type { RelayLinkEvents } from './relay-link';
import type { RelayRefusal } from './relay-refusal';
import type { PeerLinkEvents } from './peer-link';
import type { PeerKeys, SyncIdentity } from './handshake';
import { generateDeviceKeys, type DeviceKeyPairs } from '../core/keys';
import { RateLimitedError, type InboxMessage, type SignalingTransport, type SubscribeHandlers } from './signaling';

/** In-memory mailbox with the same shape as ntfy: publish, watch, and replay of recent history. */
class MemoryHub implements SignalingTransport {
  private readonly history: (InboxMessage & { mailbox: string })[] = [];
  private readonly watchers = new Set<{ mailbox: string; handlers: SubscribeHandlers }>();
  online = true;
  /** Accept publishes but lose them, as if nobody was listening. */
  deaf = false;
  /** Answer every publish with 429. */
  limited = false;
  /** Like the relay: no replay of earlier messages to a new subscriber. */
  noHistory = false;
  publishes = 0;
  attempts = 0;
  private counter = 0;

  async publish(mailbox: string, message: string, serverTimeSeconds = Date.now() / 1000): Promise<void> {
    this.attempts++;
    if (!this.online) throw new Error('offline');
    if (this.limited) throw new RateLimitedError();
    this.publishes++;
    if (this.deaf) return;
    const entry = { id: String(++this.counter), time: serverTimeSeconds, message, mailbox };
    this.history.push(entry);
    for (const w of this.watchers) if (w.mailbox === mailbox) queueMicrotask(() => w.handlers.onMessage(entry));
  }

  /** The relay closes every watch naming a limit (close code 4429/4430). */
  refuse(refusal: RelayRefusal): void {
    for (const w of [...this.watchers]) {
      w.handlers.onStatus?.('disconnected', 'refused');
      w.handlers.onRefused?.(refusal);
    }
  }

  subscribe(mailbox: string, handlers: SubscribeHandlers): () => void {
    const watcher = { mailbox, handlers };
    this.watchers.add(watcher);
    handlers.onStatus?.('connected');
    for (const m of this.noHistory ? [] : this.history.filter((h) => h.mailbox === mailbox)) {
      queueMicrotask(() => {
        if (this.watchers.has(watcher)) handlers.onMessage(m);
      });
    }
    return () => this.watchers.delete(watcher);
  }
}

/** Stands in for WebRTC: an offer code names a pending link; an answer opens both ends. */
class FakeNet {
  private readonly pending = new Map<string, FakeLink>();
  private counter = 0;
  reachable = true;
  readonly all: FakeLink[] = [];
  nextId(): string {
    return String(++this.counter);
  }
  register(id: string, link: FakeLink): void {
    this.pending.set(id, link);
  }
  find(id: string): FakeLink | undefined {
    return this.pending.get(id);
  }
  cut(filter: (l: FakeLink) => boolean = () => true): void {
    for (const l of this.all) if (filter(l)) l.drop('network lost');
  }
}

class FakeLink implements LinkEndpoint {
  id?: string;
  peer?: FakeLink;
  open = false;
  closed = false;
  constructor(
    private readonly net: FakeNet,
    readonly events: PeerLinkEvents,
    readonly owner: string,
  ) {
    net.all.push(this);
  }
  async createOffer(): Promise<{ code: string }> {
    this.id = this.net.nextId();
    this.net.register(this.id, this);
    return { code: `offer:${this.id}` };
  }
  async acceptOffer(code: string): Promise<{ code: string }> {
    const id = code.slice('offer:'.length);
    this.id = id;
    const initiator = this.net.find(id);
    if (initiator) {
      this.peer = initiator;
      initiator.peer = this;
    }
    return { code: `answer:${id}` };
  }
  async acceptAnswer(code: string): Promise<void> {
    if (code !== `answer:${this.id}` || !this.peer || !this.net.reachable) return;
    const peer = this.peer;
    queueMicrotask(() => {
      if (this.closed || peer.closed || !this.net.reachable) return;
      this.open = true;
      peer.open = true;
      this.events.onOpen();
      peer.events.onOpen();
    });
  }
  send(data: Uint8Array): void {
    const peer = this.peer;
    if (this.open && peer?.open) queueMicrotask(() => peer.events.onMessage(data));
  }
  drop(reason: string): void {
    if (!this.open) return;
    this.open = false;
    queueMicrotask(() => this.events.onClose(reason));
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const wasOpen = this.open;
    this.open = false;
    if (wasOpen && this.peer?.open) {
      const peer = this.peer;
      peer.open = false;
      queueMicrotask(() => peer.events.onClose('peer closed'));
    }
  }
}

/** Stands in for the relay's data links: two endpoints for one pair open each other. */
class FakeRelayNet {
  private readonly ends = new Map<string, Set<FakeRelayEnd>>();
  started = 0;
  readonly made: FakeRelayEnd[] = [];
  endpoint(self: string, peer: string, events: RelayLinkEvents): FakeRelayEnd {
    const end = new FakeRelayEnd(this, [self, peer].sort().join('/'), events);
    this.made.push(end);
    return end;
  }
  join(pair: string, end: FakeRelayEnd): void {
    const set = this.ends.get(pair) ?? new Set<FakeRelayEnd>();
    this.ends.set(pair, set);
    this.started++;
    for (const other of set) {
      other.up = end.up = true;
      queueMicrotask(() => {
        other.events.onOpen();
        end.events.onOpen();
      });
    }
    set.add(end);
  }
  leave(pair: string, end: FakeRelayEnd): void {
    const set = this.ends.get(pair);
    set?.delete(end);
    for (const other of set ?? []) {
      if (other.up) {
        other.up = false;
        queueMicrotask(() => other.events.onClose('other device left the relay'));
      }
    }
  }
  others(pair: string, end: FakeRelayEnd): FakeRelayEnd[] {
    return [...(this.ends.get(pair) ?? [])].filter((e) => e !== end);
  }
  openCount(): number {
    let n = 0;
    for (const set of this.ends.values()) n += set.size;
    return n;
  }
}

class FakeRelayEnd implements RelayEndpoint {
  up = false;
  private closed = false;
  constructor(
    private readonly net: FakeRelayNet,
    private readonly pair: string,
    readonly events: RelayLinkEvents,
  ) {}
  start(): void {
    this.net.join(this.pair, this);
  }
  limit(reason: 'day' | 'rate'): void {
    this.events.onLimit?.(reason);
  }
  sent = 0;
  send(data: Uint8Array): void {
    if (!this.up) return;
    this.sent++;
    for (const o of this.net.others(this.pair, this)) queueMicrotask(() => o.events.onMessage(data));
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.up = false;
    this.net.leave(this.pair, this);
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Device {
  id: string;
  /** Peers whose relay link was made with a pair key. */
  relayPairs: string[];
  mesh: PeerMesh;
  log: EventLog;
  opens: string[];
  closes: string[];
  data: string[];
  /** The path each frame in `data` came in on. */
  vias: string[];
}

function makeDevice(
  id: string,
  keys: DerivedKeys,
  hub: MemoryHub,
  net: FakeNet,
  extra: {
    retryDelaysMs?: number[];
    knownPeers?: string[];
    maxPeers?: number;
    minTriggerIntervalMs?: number;
    maxTriggerIntervalMs?: number;
    rateLimitPauseMs?: number;
    isBlocked?: (id: string) => boolean;
    relayNet?: FakeRelayNet;
    relayAfterMs?: number;
    directRetryMs?: number;
    identity?: SyncIdentity;
  } = {},
): Device {
  const log = new EventLog();
  const d: Device = { id, log, opens: [], closes: [], data: [], vias: [], relayPairs: [], mesh: undefined as unknown as PeerMesh };
  d.mesh = new PeerMesh({
    selfId: id,
    ...(extra.knownPeers ? { knownPeers: extra.knownPeers } : {}),
    topic: keys.topic,
    key: keys.key,
    transport: hub,
    createLink: (events) => new FakeLink(net, events, id),
    log,
    onPeersChanged: () => undefined,
    onLinkOpen: (p) => d.opens.push(p),
    onLinkData: (p, data, via) => {
      d.data.push(`${p}:${new TextDecoder().decode(data)}`);
      d.vias.push(via);
    },
    onLinkClose: (p) => d.closes.push(p),
    retryDelaysMs: extra.retryDelaysMs ?? [150, 300],
    minTriggerIntervalMs: extra.minTriggerIntervalMs ?? 0,
    ...(extra.maxTriggerIntervalMs !== undefined ? { maxTriggerIntervalMs: extra.maxTriggerIntervalMs } : {}),
    ...(extra.rateLimitPauseMs !== undefined ? { rateLimitPauseMs: extra.rateLimitPauseMs } : {}),
    ...(extra.maxPeers ? { maxPeers: extra.maxPeers } : {}),
    ...(extra.isBlocked ? { isBlocked: extra.isBlocked } : {}),
    ...(extra.identity ? { identity: extra.identity } : {}),
    ...(extra.relayNet
      ? {
          createRelay: (peer: string, events: RelayLinkEvents, pair?: { key: CryptoKey; only: boolean }) => {
            if (pair) d.relayPairs.push(peer);
            return extra.relayNet!.endpoint(id, peer, events);
          },
          relayAfterMs: extra.relayAfterMs ?? 50,
          directRetryMs: extra.directRetryMs ?? 150,
        }
      : {}),
  });
  return d;
}

const running: Device[] = [];
afterEach(() => {
  for (const d of running.splice(0)) d.mesh.stop();
});

async function setup(): Promise<{ keys: DerivedKeys; hub: MemoryHub; net: FakeNet }> {
  return { keys: await deriveKeys(generateSecret()), hub: new MemoryHub(), net: new FakeNet() };
}

const connectedTo = (d: Device): string[] =>
  d.mesh.peers
    .filter((p) => p.state === 'connected')
    .map((p) => p.id)
    .sort();

describe('PeerMesh', () => {
  it('connects two devices', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net);
    const b = makeDevice('bbb', keys, hub, net);
    running.push(a, b);
    a.mesh.start();
    b.mesh.start();
    await waitFor(() => a.mesh.state === 'connected' && b.mesh.state === 'connected', 3000, 'connected');
    expect(connectedTo(a)).toEqual(['bbb']);
  });

  it('connects in either start order', async () => {
    for (const order of [
      ['aaa', 'bbb'],
      ['bbb', 'aaa'],
    ] as const) {
      const { keys, hub, net } = await setup();
      const first = makeDevice(order[0], keys, hub, net);
      running.push(first);
      first.mesh.start();
      await new Promise((r) => setTimeout(r, 200));
      const second = makeDevice(order[1], keys, hub, net);
      running.push(second);
      second.mesh.start();
      await waitFor(() => first.mesh.state === 'connected' && second.mesh.state === 'connected', 3000, `order ${order.join(',')}`);
    }
  });

  it('connects three devices to each other', async () => {
    const { keys, hub, net } = await setup();
    const devices = ['aaa', 'bbb', 'ccc'].map((id) => makeDevice(id, keys, hub, net));
    running.push(...devices);
    for (const d of devices) d.mesh.start();
    await waitFor(() => devices.every((d) => connectedTo(d).length === 2), 4000, 'full mesh');
    expect(connectedTo(devices[0]!)).toEqual(['bbb', 'ccc']);
    expect(connectedTo(devices[1]!)).toEqual(['aaa', 'ccc']);
    expect(connectedTo(devices[2]!)).toEqual(['aaa', 'bbb']);
  });

  it('connects a third device that joins later to both others', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net);
    const c = makeDevice('ccc', keys, hub, net);
    running.push(a, c);
    a.mesh.start();
    c.mesh.start();
    await waitFor(() => connectedTo(a).length === 1 && connectedTo(c).length === 1, 3000, 'first pair');
    const b = makeDevice('bbb', keys, hub, net);
    running.push(b);
    b.mesh.start();
    await waitFor(() => [a, b, c].every((d) => connectedTo(d).length === 2), 4000, 'late joiner meshed');
  });

  it('reconnects only the pair whose link dropped', async () => {
    const { keys, hub, net } = await setup();
    const devices = ['aaa', 'bbb', 'ccc'].map((id) => makeDevice(id, keys, hub, net));
    running.push(...devices);
    for (const d of devices) d.mesh.start();
    await waitFor(() => devices.every((d) => connectedTo(d).length === 2), 4000, 'full mesh');
    const [a, b, c] = devices as [Device, Device, Device];
    // Drop the a–b link only.
    net.cut((l) => (l.owner === 'aaa' && l.peer?.owner === 'bbb') || (l.owner === 'bbb' && l.peer?.owner === 'aaa'));
    await waitFor(() => a.opens.filter((p) => p === 'bbb').length === 2, 3000, 'a–b reconnected');
    expect(a.closes).toEqual(['bbb']);
    expect(c.closes).toEqual([]);
    expect(c.opens.sort()).toEqual(['aaa', 'bbb']);
    expect(connectedTo(b)).toEqual(['aaa', 'ccc']);
  });

  it('acts at once on a forced reconnect instead of waiting for retry timers', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net, { retryDelaysMs: [60_000] });
    const b = makeDevice('bbb', keys, hub, net, { retryDelaysMs: [60_000] });
    running.push(a, b);
    a.mesh.start();
    b.mesh.start();
    await waitFor(() => a.opens.length === 1, 3000, 'first connect');
    hub.online = false;
    net.reachable = false;
    net.cut();
    await waitFor(() => a.closes.length === 1 && b.closes.length === 1, 2000, 'drop');
    hub.online = true;
    net.reachable = true;
    a.mesh.reconnect('wake', { force: true, streamLikelyDead: true });
    b.mesh.reconnect('wake', { force: true, streamLikelyDead: true });
    await waitFor(() => a.opens.length === 2 && b.opens.length === 2, 2000, 'reconnect after wake');
  });

  it('delivers data to the right peer', async () => {
    const { keys, hub, net } = await setup();
    const devices = ['aaa', 'bbb', 'ccc'].map((id) => makeDevice(id, keys, hub, net));
    running.push(...devices);
    for (const d of devices) d.mesh.start();
    await waitFor(() => devices.every((d) => connectedTo(d).length === 2), 4000, 'full mesh');
    devices[0]!.mesh.send('ccc', new TextEncoder().encode('hi c'));
    await waitFor(() => devices[2]!.data.includes('aaa:hi c'), 1000, 'data to c');
    expect(devices[1]!.data).toEqual([]);
  });

  it('ignores an offer addressed to another device', async () => {
    const { keys, hub, net } = await setup();
    const c = makeDevice('ccc', keys, hub, net);
    running.push(c);
    c.mesh.start();
    const offer = await seal(keys.key, keys.topic, { type: 'offer', from: 'aaa', to: 'bbb', sid: 's', ts: Date.now(), code: 'offer:1' });
    await hub.publish(keys.topic, offer);
    await new Promise((r) => setTimeout(r, 150));
    expect(c.log.all().some((e) => e.detail.includes('answering offer'))).toBe(false);
  });

  it('ignores messages sealed with a different key', async () => {
    const { keys, hub, net } = await setup();
    const other = await deriveKeys(generateSecret());
    const a = makeDevice('aaa', keys, hub, net);
    running.push(a);
    a.mesh.start();
    await hub.publish(keys.topic, await seal(other.key, keys.topic, { type: 'hello', from: 'bbb', sid: 'x', ts: Date.now() }));
    await waitFor(() => a.log.all().some((e) => e.detail.includes('could not authenticate')), 1000, 'drop logged');
    expect(a.mesh.peers).toEqual([]);
  });

  it('ignores a cached offer stamped long ago by the server', async () => {
    const { keys, hub, net } = await setup();
    const old = await seal(keys.key, keys.topic, { type: 'offer', from: 'aaa', to: 'bbb', sid: 'stale', ts: Date.now(), code: 'offer:9' });
    await hub.publish(keys.topic, old, Date.now() / 1000 - 120);
    const b = makeDevice('bbb', keys, hub, net);
    running.push(b);
    b.mesh.start();
    await waitFor(() => b.log.all().some((e) => e.detail.includes('ignored an old offer')), 1000, 'stale offer ignored');
  });

  it('caps the number of peers', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net, { maxPeers: 1 });
    running.push(a);
    a.mesh.start();
    for (const from of ['bbb', 'ccc']) {
      await hub.publish(keys.topic, await seal(keys.key, keys.topic, { type: 'hello', from, sid: from, ts: Date.now() }));
    }
    await new Promise((r) => setTimeout(r, 150));
    expect(a.mesh.peers.map((p) => p.id)).toEqual(['bbb']);
  });

  it('sends nothing periodic while peers are absent', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net, { knownPeers: ['bbb'], retryDelaysMs: [100, 100] });
    running.push(a);
    a.mesh.start();
    await new Promise((r) => setTimeout(r, 900));
    const settled = hub.publishes;
    await new Promise((r) => setTimeout(r, 600));
    // A hello and an offer with two retries to the known peer, then nothing more.
    expect(hub.publishes).toBe(settled);
    expect(settled).toBeLessThanOrEqual(4);
  });

  it('forgets a peer', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net, { knownPeers: ['old'] });
    running.push(a);
    a.mesh.forget('old');
    expect(a.mesh.peers).toEqual([]);
  });

  it('never replaces an offer that is waiting for its answer on automatic triggers', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net, { knownPeers: ['bbb'], retryDelaysMs: [60_000] });
    running.push(a);
    a.mesh.start();
    await waitFor(() => hub.publishes === 2, 1000, 'hello and offer');
    // Past the short grace that protects a brand-new offer.
    await new Promise((r) => setTimeout(r, 3100));
    // A phone that is asleep: edits and focus on this device keep firing.
    for (let i = 0; i < 20; i++) {
      a.mesh.reconnect('local edit');
      a.mesh.reconnect('focus');
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(hub.publishes).toBe(2);
  });

  it('backs off automatic hellos while nobody answers', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net, { minTriggerIntervalMs: 50, maxTriggerIntervalMs: 400 });
    running.push(a);
    a.mesh.start();
    await waitFor(() => hub.publishes === 1, 1000, 'start hello');
    const t0 = Date.now();
    while (Date.now() - t0 < 1000) {
      a.mesh.reconnect('local edit');
      await new Promise((r) => setTimeout(r, 10));
    }
    // Without the back-off this would be 20 hellos; with it, about one per 50, 100, 200, 400, 400 ms.
    expect(hub.publishes - 1).toBeGreaterThanOrEqual(3);
    expect(hub.publishes - 1).toBeLessThanOrEqual(6);
  });

  it('a wake trigger is not held back by the background back-off', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net, { minTriggerIntervalMs: 50, maxTriggerIntervalMs: 10_000 });
    running.push(a);
    a.mesh.start();
    for (let i = 0; i < 5; i++) {
      a.mesh.reconnect('local edit');
      await new Promise((r) => setTimeout(r, 60));
    }
    const before = hub.publishes;
    a.mesh.reconnect('local edit');
    expect(hub.publishes).toBe(before);
    a.mesh.reconnect('visible', { wake: true });
    await waitFor(() => hub.publishes === before + 1, 500, 'wake hello');
  });

  it('connects through hellos when an automatic trigger fires after lost messages', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net);
    const b = makeDevice('bbb', keys, hub, net);
    running.push(a, b);
    hub.deaf = true;
    a.mesh.start();
    b.mesh.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(a.mesh.peers).toEqual([]);
    hub.deaf = false;
    b.mesh.reconnect('focus');
    await waitFor(() => a.mesh.state === 'connected' && b.mesh.state === 'connected', 2000, 'connected via hello');
  });

  it('stops publishing for a while after the server answers 429', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net, { knownPeers: ['bbb'], retryDelaysMs: [20, 20], rateLimitPauseMs: 300 });
    running.push(a);
    hub.limited = true;
    a.mesh.start();
    await waitFor(() => a.mesh.signalingPausedUntil !== undefined, 1000, 'paused');
    await new Promise((r) => setTimeout(r, 100));
    const tried = hub.attempts;
    for (let i = 0; i < 5; i++) a.mesh.reconnect('reconnect button', { force: true });
    await new Promise((r) => setTimeout(r, 50));
    // Retries and button presses during the pause send nothing.
    expect(hub.attempts).toBe(tried);
    expect(tried).toBeLessThanOrEqual(2);
    hub.limited = false;
    await new Promise((r) => setTimeout(r, 300));
    expect(a.mesh.signalingPausedUntil).toBeUndefined();
    a.mesh.reconnect('reconnect button', { force: true });
    await waitFor(() => hub.publishes > 0, 1000, 'publishing again');
  });

  it('a refusal naming a limit pauses connections for the time the relay gave, and shows it meanwhile', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net, { knownPeers: ['bbb'] });
    running.push(a);
    a.mesh.start();
    hub.refuse({ kind: 'rate', retryMs: 250 });
    expect(a.mesh.relayRefusal).toMatchObject({ kind: 'rate' });
    expect(a.mesh.signalingPausedUntil).toBeDefined();
    const tried = hub.attempts;
    a.mesh.reconnect('reconnect button', { force: true });
    expect(hub.attempts).toBe(tried);
    await waitFor(() => a.mesh.signalingPausedUntil === undefined, 1500, 'pause over');
    await waitFor(() => a.mesh.relayRefusal === undefined, 500, 'refusal cleared');
    await waitFor(() => hub.attempts > tried, 1000, 'publishing again');
  });

  it('a plain signaling drop pauses nothing and shows no limit', async () => {
    const { keys, hub, net } = await setup();
    const a = makeDevice('aaa', keys, hub, net, { knownPeers: ['bbb'] });
    running.push(a);
    a.mesh.start();
    for (const w of [...(hub as unknown as { watchers: Set<{ handlers: SubscribeHandlers }> }).watchers]) w.handlers.onStatus?.('disconnected', 'closed (1006)');
    expect(a.mesh.signalingPausedUntil).toBeUndefined();
    expect(a.mesh.relayRefusal).toBeUndefined();
    a.mesh.reconnect('online', { force: true });
    await waitFor(() => hub.publishes > 0, 1000, 'publishing');
  });

  it('meshes devices that join one after another on a mailbox without history (the relay)', async () => {
    for (const order of [
      ['ccc', 'bbb', 'aaa'],
      ['bbb', 'ccc', 'aaa'],
      ['aaa', 'ccc', 'bbb'],
      ['ccc', 'aaa', 'bbb'],
    ]) {
      const { keys, hub, net } = await setup();
      hub.noHistory = true;
      const devices: Device[] = [];
      for (const id of order) {
        const d = makeDevice(id, keys, hub, net);
        running.push(d);
        devices.push(d);
        d.mesh.start();
        await new Promise((r) => setTimeout(r, 20));
      }
      await waitFor(() => devices.every((d) => connectedTo(d).length === 2), 3000, `mesh for join order ${order.join(',')}`);
    }
  });

  it('answers a hello only to its sender, so hellos do not cascade', async () => {
    const { keys, hub, net } = await setup();
    hub.noHistory = true;
    const devices = ['bbb', 'ccc', 'ddd'].map((id) => makeDevice(id, keys, hub, net));
    running.push(...devices);
    for (const d of devices) d.mesh.start();
    await waitFor(() => devices.every((d) => connectedTo(d).length === 2), 3000, 'three meshed');
    const before = hub.publishes;
    const a = makeDevice('aaa', keys, hub, net);
    running.push(a);
    a.mesh.start();
    await waitFor(() => connectedTo(a).length === 3, 3000, 'newcomer meshed');
    await new Promise((r) => setTimeout(r, 200));
    // The newcomer's hello, one reply addressed to it from each device, and an offer from the
    // newcomer (it has the lowest id) answered by each. Nothing else: replies do not cascade.
    expect(hub.publishes - before).toBeLessThanOrEqual(1 + 3 + 3 * 2);
  });

  it('keys required: answers the hello of a peer whose mesh restarted right after our last reply, once the interval is over (#30)', async () => {
    const { keys, hub, net } = await setup();
    hub.noHistory = true;
    const certs = await Certs.of(['aaa', 'bbb']);
    certs.required = true;
    const a = makeDevice('aaa', keys, hub, net, { identity: certs.identity('aaa') });
    const b = makeDevice('bbb', keys, hub, net, { identity: certs.identity('bbb') });
    running.push(a, b);
    b.mesh.start();
    a.mesh.start();
    await waitFor(() => connectedTo(a).length === 1 && connectedTo(b).length === 1, 3000, 'first link');
    // The initiator's mesh is made again (a share member coming back) while b's reply is seconds old: it knows no peer
    // yet, so it waits for b's hello, and b used to wait for a's.
    a.mesh.stop();
    await waitFor(() => connectedTo(b).length === 0, 3000, 'b sees the link end');
    const again = makeDevice('aaa', keys, hub, net, { identity: certs.identity('aaa') });
    running.push(again);
    again.mesh.start();
    await waitFor(() => connectedTo(again).length === 1 && connectedTo(b).length === 1, 9000, 'linked again after the interval');
  }, 15000);

  it('ignores a removed device', async () => {
    const { keys, hub, net } = await setup();
    const blocked = new Set(['ccc']);
    const a = makeDevice('aaa', keys, hub, net, { isBlocked: (id) => blocked.has(id), knownPeers: ['ccc'] });
    const b = makeDevice('bbb', keys, hub, net);
    const c = makeDevice('ccc', keys, hub, net);
    running.push(a, b, c);
    for (const d of [a, b, c]) d.mesh.start();
    await waitFor(() => connectedTo(a).length === 1 && connectedTo(c).length === 1, 3000, 'a–b and b–c');
    await new Promise((r) => setTimeout(r, 200));
    expect(connectedTo(a)).toEqual(['bbb']);
    expect(a.mesh.peers.map((p) => p.id)).toEqual(['bbb']);
  });

  describe('relay fallback', () => {
    it('syncs through the relay when no direct link opens, and moves to direct when it can', async () => {
      const { keys, hub, net } = await setup();
      net.reachable = false;
      const relayNet = new FakeRelayNet();
      const a = makeDevice('aaa', keys, hub, net, { relayNet });
      const b = makeDevice('bbb', keys, hub, net, { relayNet });
      running.push(a, b);
      a.mesh.start();
      b.mesh.start();
      await waitFor(() => a.mesh.state === 'connected' && b.mesh.state === 'connected', 3000, 'connected through the relay');
      expect(a.mesh.peers[0]?.via).toBe('relay');
      expect(a.opens).toEqual(['bbb']);

      a.mesh.send('bbb', new TextEncoder().encode('over relay'));
      await waitFor(() => b.data.includes('aaa:over relay'), 3000, 'data over relay');

      net.reachable = true;
      await waitFor(() => a.mesh.peers[0]?.via === 'direct' && b.mesh.peers[0]?.via === 'direct', 5000, 'direct again');
      expect(a.opens).toEqual(['bbb']);
      expect(a.closes).toEqual([]);
      b.mesh.send('aaa', new TextEncoder().encode('now direct'));
      await waitFor(() => a.data.includes('bbb:now direct'), 3000, 'data direct');
      await waitFor(() => relayNet.openCount() === 0, 5000, 'relay released');
    });

    it('sendDirect puts nothing on the relay while a relay path and a direct link are both open; relay data is marked as such (#166)', async () => {
      const { keys, hub, net } = await setup();
      net.reachable = false;
      const relayNet = new FakeRelayNet();
      const a = makeDevice('aaa', keys, hub, net, { relayNet });
      const b = makeDevice('bbb', keys, hub, net, { relayNet });
      running.push(a, b);
      a.mesh.start();
      b.mesh.start();
      await waitFor(() => a.mesh.peers[0]?.via === 'relay' && b.mesh.peers[0]?.via === 'relay', 3000, 'relay');
      expect(a.mesh.sendDirect('bbb', new Uint8Array([1]))).toBe(false);
      expect(relayNet.made.reduce((n, e) => n + e.sent, 0)).toBe(0);
      net.reachable = true;
      await waitFor(() => a.mesh.peers[0]?.via === 'direct' && b.mesh.peers[0]?.via === 'direct', 5000, 'direct');
      // Inside the hand-over window the relay endpoints are still up.
      const open = relayNet.made.filter((e) => e.up);
      expect(open.length).toBeGreaterThan(0);
      const before = relayNet.made.reduce((n, e) => n + e.sent, 0);
      expect(a.mesh.sendDirect('bbb', new TextEncoder().encode('file bytes'))).toBe(true);
      await waitFor(() => b.data.includes('aaa:file bytes'), 3000, 'data direct');
      expect(relayNet.made.reduce((n, e) => n + e.sent, 0)).toBe(before);
      expect(b.vias[b.data.indexOf('aaa:file bytes')]).toBe('direct');
      // Whatever arrives on the relay path is marked relay, so file frames on it can be refused.
      open[0]!.send(new TextEncoder().encode('via relay'));
      await waitFor(() => a.data.includes('bbb:via relay') || b.data.includes('aaa:via relay'), 3000, 'relay data');
      const d = a.data.includes('bbb:via relay') ? a : b;
      expect(d.vias[d.data.findIndex((x) => x.endsWith(':via relay'))]).toBe('relay');
    });

    it('reports the loss when the other device leaves the relay', async () => {
      const { keys, hub, net } = await setup();
      net.reachable = false;
      const relayNet = new FakeRelayNet();
      const a = makeDevice('aaa', keys, hub, net, { relayNet });
      const b = makeDevice('bbb', keys, hub, net, { relayNet });
      running.push(a, b);
      a.mesh.start();
      b.mesh.start();
      await waitFor(() => a.mesh.state === 'connected' && b.mesh.state === 'connected', 3000, 'connected');
      b.mesh.stop();
      await waitFor(() => a.closes.includes('bbb'), 3000, 'close reported');
      expect(a.mesh.peers[0]?.state).not.toBe('connected');
    });

    it('reports a relay limit and stays connected', async () => {
      const { keys, hub, net } = await setup();
      net.reachable = false;
      const relayNet = new FakeRelayNet();
      const a = makeDevice('aaa', keys, hub, net, { relayNet });
      const b = makeDevice('bbb', keys, hub, net, { relayNet });
      running.push(a, b);
      a.mesh.start();
      b.mesh.start();
      await waitFor(() => a.mesh.state === 'connected', 3000, 'connected');
      relayNet.made[0]?.limit('day');
      expect(a.mesh.relayLimit).toBe('day');
      expect(a.mesh.state).toBe('connected');
    });

    it('opens no sockets while paused for the relay refusing this network, then starts over', async () => {
      const { keys, hub, net } = await setup();
      net.reachable = false;
      const relayNet = new FakeRelayNet();
      const a = makeDevice('aaa', keys, hub, net, { knownPeers: ['bbb'], relayNet });
      running.push(a);
      a.mesh.start();
      await waitFor(() => relayNet.openCount() === 1, 3000, 'waiting on the relay');
      a.mesh.pauseConnections(300);
      expect(relayNet.openCount()).toBe(0);
      expect(a.mesh.signalingPausedUntil).toBeDefined();
      const tried = hub.attempts;
      const made = relayNet.made.length;
      for (let i = 0; i < 5; i++) a.mesh.reconnect('reconnect button', { force: true });
      await new Promise((r) => setTimeout(r, 150));
      // Button presses, retries and relay timers during the pause open nothing.
      expect(hub.attempts).toBe(tried);
      expect(relayNet.made.length).toBe(made);
      // After the pause the device starts over by itself and finds the other one.
      const b = makeDevice('bbb', keys, hub, net, { relayNet });
      running.push(b);
      b.mesh.start();
      await waitFor(() => a.mesh.state === 'connected' && b.mesh.state === 'connected', 3000, 'connected after the pause');
      expect(a.mesh.signalingPausedUntil).toBeUndefined();
    });

    it('keeps an open relay link when pausing', async () => {
      const { keys, hub, net } = await setup();
      net.reachable = false;
      const relayNet = new FakeRelayNet();
      const a = makeDevice('aaa', keys, hub, net, { relayNet });
      const b = makeDevice('bbb', keys, hub, net, { relayNet });
      running.push(a, b);
      a.mesh.start();
      b.mesh.start();
      await waitFor(() => a.mesh.state === 'connected' && b.mesh.state === 'connected', 3000, 'connected');
      a.mesh.pauseConnections(1000);
      a.mesh.send('bbb', new TextEncoder().encode('still here'));
      await waitFor(() => b.data.includes('aaa:still here'), 3000, 'data during the pause');
      expect(a.mesh.state).toBe('connected');
    });

    it('does not touch the relay while a direct link opens quickly', async () => {
      const { keys, hub, net } = await setup();
      const relayNet = new FakeRelayNet();
      const a = makeDevice('aaa', keys, hub, net, { relayNet, relayAfterMs: 400 });
      const b = makeDevice('bbb', keys, hub, net, { relayNet, relayAfterMs: 400 });
      running.push(a, b);
      a.mesh.start();
      b.mesh.start();
      await waitFor(() => a.mesh.state === 'connected' && b.mesh.state === 'connected', 3000, 'connected');
      await new Promise((r) => setTimeout(r, 500));
      expect(relayNet.started).toBe(0);
      expect(a.mesh.peers[0]?.via).toBe('direct');
    });
  });
});

/** Certified device keys for tests: every listed device is certified; `required` is shared. */
class Certs {
  readonly keys = new Map<string, DeviceKeyPairs>();
  required = false;
  static async of(ids: string[]): Promise<Certs> {
    const c = new Certs();
    for (const id of ids) c.keys.set(id, await generateDeviceKeys());
    return c;
  }
  identity(self: string, override: Record<string, PeerKeys> = {}): SyncIdentity {
    return {
      own: () => {
        const k = this.keys.get(self);
        return k ? { sign: k.sign.privateKey, agree: k.agree.privateKey } : undefined;
      },
      peer: (id) => override[id] ?? this.keys.get(id)?.publicKeys,
      required: () => this.required,
    };
  }
}

const logText = (d: Device): string => d.log.toText();

describe('signed handshake (#256)', () => {
  it('two certified devices prove their links with their device keys', async () => {
    const { keys, hub, net } = await setup();
    const certs = await Certs.of(['aaa', 'bbb']);
    const a = makeDevice('aaa', keys, hub, net, { identity: certs.identity('aaa') });
    const b = makeDevice('bbb', keys, hub, net, { identity: certs.identity('bbb') });
    running.push(a, b);
    a.mesh.start();
    b.mesh.start();
    await waitFor(() => a.mesh.isVerified('bbb') && b.mesh.isVerified('aaa'), 3000, 'verified both ways');
  });

  it('compatible mode: a certified device still syncs with an older build that signs nothing', async () => {
    const { keys, hub, net } = await setup();
    const certs = await Certs.of(['aaa']);
    for (const order of [['aaa', 'bbb'], ['bbb', 'aaa']] as const) {
      const x = makeDevice(order[0], keys, hub, net, order[0] === 'aaa' ? { identity: certs.identity('aaa') } : {});
      const y = makeDevice(order[1], keys, hub, net, order[1] === 'aaa' ? { identity: certs.identity('aaa') } : {});
      running.push(x, y);
      x.mesh.start();
      y.mesh.start();
      await waitFor(() => x.mesh.state === 'connected' && y.mesh.state === 'connected', 3000, 'connected');
      expect(x.mesh.isVerified(y.id)).toBe(false);
      x.mesh.stop();
      y.mesh.stop();
    }
  });

  it('keys required: a device without a certificate gets no link, the certified ones do', async () => {
    const { keys, hub, net } = await setup();
    const certs = await Certs.of(['aaa', 'ccc']);
    certs.required = true;
    const a = makeDevice('aaa', keys, hub, net, { identity: certs.identity('aaa') });
    // bbb holds the sync code and claims a device id, but has no certificate.
    const b = makeDevice('bbb', keys, hub, net, { identity: certs.identity('bbb') });
    const c = makeDevice('ccc', keys, hub, net, { identity: certs.identity('ccc') });
    running.push(a, b, c);
    for (const d of [a, b, c]) d.mesh.start();
    await waitFor(() => a.mesh.isVerified('ccc') && c.mesh.isVerified('aaa'), 3000, 'a and c verified');
    await new Promise((r) => setTimeout(r, 400));
    expect(connectedTo(b)).toEqual([]);
    expect(a.opens).not.toContain('bbb');
    expect(c.opens).not.toContain('bbb');
    expect(logText(a)).toContain('no valid device key');
  });

  it('keys required: a forged signature (someone else signing for a certified id) is refused', async () => {
    const { keys, hub, net } = await setup();
    const certs = await Certs.of(['aaa', 'bbb']);
    certs.required = true;
    const impostor = await Certs.of(['bbb']);
    impostor.required = true;
    const a = makeDevice('aaa', keys, hub, net, { identity: certs.identity('aaa') });
    const b = makeDevice('bbb', keys, hub, net, { identity: { ...certs.identity('bbb'), own: impostor.identity('bbb').own } });
    running.push(a, b);
    a.mesh.start();
    b.mesh.start();
    await new Promise((r) => setTimeout(r, 500));
    expect(a.opens).toEqual([]);
  });

  it('a deliberately broken pair key on signaling: the pair falls back to the shared key and connects', async () => {
    const { keys, hub, net } = await setup();
    const certs = await Certs.of(['aaa', 'bbb']);
    const wrong = (await generateDeviceKeys()).publicKeys;
    // aaa derives its pair key with bbb from the wrong agree key; bbb cannot open aaa's sealed offers.
    const a = makeDevice('aaa', keys, hub, net, { identity: certs.identity('aaa', { bbb: { sign: certs.keys.get('bbb')!.publicKeys.sign, agree: wrong.agree } }) });
    const b = makeDevice('bbb', keys, hub, net, { identity: certs.identity('bbb') });
    running.push(a, b);
    b.mesh.start();
    await new Promise((r) => setTimeout(r, 50));
    a.mesh.start();
    // The first offer may go out before the hellos tell each side the other verified it; a reconnect uses the pair key.
    await waitFor(() => a.mesh.state === 'connected' && b.mesh.state === 'connected', 5000, 'connected');
    net.cut();
    await waitFor(() => logText(a).includes('pair key failed'), 10000, 'pair key given up');
    await waitFor(() => a.mesh.state === 'connected' && b.mesh.state === 'connected' && a.opens.length === 2, 10000, 'connected again with the shared key');
    // Shown on the Devices page.
    expect(a.mesh.peers.find((p) => p.id === 'bbb')?.sharedKey).toBe(true);
  }, 20000);

  it('keys required: a broken pair key never falls back to the shared key', async () => {
    const { keys, hub, net } = await setup();
    const certs = await Certs.of(['aaa', 'bbb']);
    certs.required = true;
    const wrong = (await generateDeviceKeys()).publicKeys;
    const a = makeDevice('aaa', keys, hub, net, { identity: certs.identity('aaa', { bbb: { sign: certs.keys.get('bbb')!.publicKeys.sign, agree: wrong.agree } }) });
    const b = makeDevice('bbb', keys, hub, net, { identity: certs.identity('bbb') });
    running.push(a, b);
    b.mesh.start();
    a.mesh.start();
    // The first offer may go out before the hellos; once both list each other, every offer is pair-sealed.
    await new Promise((r) => setTimeout(r, 300));
    net.cut();
    await new Promise((r) => setTimeout(r, 1500));
    expect(logText(a)).not.toContain('pair key failed');
    expect(a.mesh.peers.find((p) => p.id === 'bbb')?.sharedKey).toBeUndefined();
  });

  it('keys required: the relay is used only with a pair key', async () => {
    const { keys, hub, net } = await setup();
    net.reachable = false;
    const relayNet = new FakeRelayNet();
    const certs = await Certs.of(['aaa', 'bbb']);
    certs.required = true;
    const a = makeDevice('aaa', keys, hub, net, { relayNet, identity: certs.identity('aaa') });
    const b = makeDevice('bbb', keys, hub, net, { relayNet, identity: certs.identity('bbb') });
    const c = makeDevice('ccc', keys, hub, net, { relayNet, identity: certs.identity('ccc') });
    running.push(a, b, c);
    for (const d of [a, b, c]) d.mesh.start();
    await waitFor(() => a.mesh.isVerified('bbb') && b.mesh.isVerified('aaa'), 3000, 'verified over the relay');
    expect(a.relayPairs).toContain('bbb');
    await new Promise((r) => setTimeout(r, 300));
    expect(a.opens).not.toContain('ccc');
    expect(logText(c)).toContain('relay skipped');
  });
});
