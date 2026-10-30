import type { EventLog } from './event-log';
import { RELAY_CONTEXT_PREFIX, RELAY_PAIR_DIGEST } from '../core/protocol-ids';
import { parseRelayRefusal, type RelayRefusal } from './relay-refusal';

/**
 * A data path between two devices through the site's relay, for when no direct WebRTC path opens.
 * Both devices connect to `/signal/<topic>/link/<pair>`; the relay forwards each binary frame to
 * the other socket of the pair and keeps nothing. Every message is sealed with the account key
 * before it leaves the device (AES-GCM, as signaling is), so the relay sees ciphertext and sizes.
 *
 * Frames (first byte):
 *   0 hello  sealed "hello"   sent when the socket opens; the peer answers with an ack
 *   1 ack    sealed "ack"
 *   2 piece  msgId u32, index u16, count u16, then a slice of one sealed message
 * A message is sealed whole and cut into pieces of at most PIECE_BYTES, so a large catch-up fits
 * the relay's frame limit. Text frames from the relay: `pong`, and `{"event":"left"}` when the
 * other device's socket ended.
 */

const HELLO = 0;
const ACK = 1;
const PIECE = 2;
const PIECE_HEADER = 9;
export const PIECE_BYTES = 32 * 1024;
const NONCE_BYTES = 12;

/** Sending is paced under the relay's per-socket caps (worker/index.ts): bytes and frames per second. */
const BYTES_PER_SECOND = 320_000;
const BYTES_BURST = 128 * 1024;
const FRAMES_PER_SECOND = 30;
const FRAMES_BURST = 60;
/** Messages waiting for the pacer beyond this are dropped; the periodic re-sync repairs the gap. */
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;
/** Partly received messages kept at once, and their total size. */
const MAX_PARTIAL_MESSAGES = 8;
const MAX_PARTIAL_BYTES = 64 * 1024 * 1024;

/** Both devices of a pair derive the same 32 hex characters; the relay learns no device id from it. */
export async function pairTag(topic: string, a: string, b: string): Promise<string> {
  const [x, y] = a < b ? [a, b] : [b, a];
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${RELAY_PAIR_DIGEST}${topic}:${x}:${y}`)));
  return [...digest.subarray(0, 16)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** After the relay refuses data, wait this long before connecting again. */
const LIMIT_RETRY_MS = 10 * 60_000;
const RATE_RETRY_MS = 30_000;
/** After this many attempts in a row that never opened, retry at most every 5 minutes. */
const SLOW_AFTER_FAILURES = 6;
const SLOW_RETRY_MS = 5 * 60_000;

export interface RelayLinkEvents {
  /** The other device is on the relay too (also when it came back after leaving). */
  onOpen(): void;
  /** The other device or the socket went away. Not called before the first onOpen. */
  onClose(reason: string): void;
  onMessage(data: Uint8Array): void;
  /** The relay refused more data: `day` = the room's daily budget is spent, `rate` = too fast. Direct sync is unaffected. */
  onLimit?(reason: 'day' | 'rate' | 'service'): void;
  /** The relay turned this network away when the socket opened (see relay-refusal.ts); the link waits out the pause. */
  onRefused?(refusal: RelayRefusal): void;
  /** The pair key did not work with the other device; the link went on with the shared key. */
  onPairFailed?(): void;
}

export interface RelayLinkOptions {
  /** The relay's address, `wss://host/signal`; the link is `<baseUrl>/<topic>/link/<pair>`. */
  baseUrl: string;
  topic: string;
  selfId: string;
  peerId: string;
  key: CryptoKey;
  /**
   * Pair key of two certified devices (#256, S-76f): frames go sealed with it. Received frames sealed
   * with `key` are still accepted unless `only` (keys required); the link then answers with `key`,
   * since the other device cannot derive the pair key (an older build, or its certificate is not here yet).
   */
  pair?: { key: CryptoKey; only: boolean };
  log: EventLog;
  WebSocketImpl?: typeof WebSocket;
  retryMs?: number;
  maxRetryMs?: number;
  keepaliveMs?: number;
  pongTimeoutMs?: number;
  connectTimeoutMs?: number;
}

interface PartialMessage {
  count: number;
  parts: Map<number, Uint8Array>;
  bytes: number;
}

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

export class RelayLink {
  private socket: WebSocket | undefined;
  private url = '';
  private context = '';
  private closed = false;
  /** Connection attempts in a row that never opened; every one is a Cloudflare request, so the wait grows. */
  private failures = 0;
  /** Set when the relay refused data: how long to stay away. */
  private pauseMs = 0;
  private socketUp = false;
  private peerHere = false;
  private retry: number;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private pumpTimer: ReturnType<typeof setTimeout> | undefined;
  private sealing: Promise<void> = Promise.resolve();
  private receiving: Promise<void> = Promise.resolve();
  private readonly queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private byteTokens = BYTES_BURST;
  private frameTokens = FRAMES_BURST;
  private refilledAt = Date.now();
  private nextMessageId = Math.floor(Math.random() * 0x1_0000_0000);
  private readonly partial = new Map<number, PartialMessage>();
  /** The key frames are sealed with now. */
  private sendKey: CryptoKey;
  /** The pair key failed on this link: shared key only from now on. */
  private pairOff = false;
  private partialBytes = 0;

  constructor(
    private readonly opts: RelayLinkOptions,
    private readonly events: RelayLinkEvents,
  ) {
    this.retry = opts.retryMs ?? 1000;
    this.sendKey = opts.pair?.key ?? opts.key;
  }

  get open(): boolean {
    return this.peerHere;
  }

  start(): void {
    const { baseUrl, topic, selfId, peerId } = this.opts;
    pairTag(topic, selfId, peerId).then(
      (pair) => {
        if (this.closed) return;
        // Binds sealed messages to this pair, so a frame cannot be moved to another pair or kind.
        this.context = `${topic}:${pair}`;
        this.url = `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(topic)}/link/${pair}`;
        this.connect();
      },
      () => this.opts.log.log('relay', 'could not work out the link address'),
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopTimers();
    clearTimeout(this.retryTimer);
    clearTimeout(this.pumpTimer);
    const socket = this.socket;
    this.socket = undefined;
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.peerHere = false;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try {
        socket.close(1000, 'done');
      } catch {
        // Already closed.
      }
    }
  }

  /** Queues one message for the other device, in call order; dropped while the other device is not on the relay. */
  send(data: Uint8Array): void {
    if (!this.peerHere || this.closed) return;
    this.sealing = this.sealing.then(() => this.enqueue(data));
  }

  private async enqueue(data: Uint8Array): Promise<void> {
    if (!this.peerHere || this.closed) return;
    if (this.queuedBytes + data.length > MAX_QUEUED_BYTES) {
      this.opts.log.log('relay', 'send queue full: message dropped');
      return;
    }
    let sealed: Uint8Array;
    try {
      sealed = await this.seal('data', data);
    } catch {
      return;
    }
    const id = this.nextMessageId++ >>> 0;
    const count = Math.max(1, Math.ceil(sealed.length / PIECE_BYTES));
    for (let i = 0; i < count; i++) {
      const body = sealed.subarray(i * PIECE_BYTES, (i + 1) * PIECE_BYTES);
      const frame = new Uint8Array(PIECE_HEADER + body.length);
      const view = new DataView(frame.buffer);
      frame[0] = PIECE;
      view.setUint32(1, id);
      view.setUint16(5, i);
      view.setUint16(7, count);
      frame.set(body, PIECE_HEADER);
      this.queue.push(frame);
      this.queuedBytes += frame.length;
    }
    this.pump();
  }

  // ---- socket ----------------------------------------------------------------------------------

  private connect(): void {
    if (this.closed) return;
    const Impl = this.opts.WebSocketImpl ?? (typeof WebSocket === 'undefined' ? undefined : WebSocket);
    if (!Impl) {
      this.opts.log.log('relay', 'WebSocket is not available');
      return;
    }
    let socket: WebSocket;
    try {
      socket = new Impl(this.url);
    } catch (e) {
      this.dropped(undefined, `could not open: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    const current = (): boolean => this.socket === socket && !this.closed;
    this.connectTimer = setTimeout(() => {
      if (current() && !this.socketUp) this.dropped(socket, 'connect timed out');
    }, this.opts.connectTimeoutMs ?? 15_000);
    socket.onopen = () => {
      if (!current()) return;
      clearTimeout(this.connectTimer);
      this.socketUp = true;
      this.failures = 0;
      this.retry = this.opts.retryMs ?? 1000;
      this.opts.log.log('relay', 'socket open');
      this.startKeepalive(socket);
      void this.sendControl(HELLO);
    };
    socket.onmessage = (event: MessageEvent) => {
      if (!current()) return;
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
      // One at a time and in arrival order: unsealing is async and a small message must not overtake a large one.
      this.receiving = this.receiving.then(() => this.onFrame(event.data));
    };
    socket.onerror = () => {
      if (current()) this.dropped(socket, this.socketUp ? 'connection error' : 'could not connect');
    };
    socket.onclose = (event: CloseEvent) => {
      if (!current()) return;
      const refusal = parseRelayRefusal(event.code, event.reason);
      if (!refusal) {
        this.dropped(socket, event.reason || `closed (${event.code})`);
        return;
      }
      this.pauseMs = refusal.retryMs;
      this.dropped(socket, `refused by the relay (${refusal.kind})`);
      this.events.onRefused?.(refusal);
    };
  }

  private startKeepalive(socket: WebSocket): void {
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = setInterval(() => {
      if (this.socket !== socket || !this.socketUp) return;
      try {
        socket.send('ping');
      } catch {
        this.dropped(socket, 'ping failed');
        return;
      }
      this.pongTimer ??= setTimeout(() => {
        this.pongTimer = undefined;
        if (this.socket === socket) this.dropped(socket, 'no answer to ping');
      }, this.opts.pongTimeoutMs ?? 10_000);
    }, this.opts.keepaliveMs ?? 25_000);
  }

  private dropped(socket: WebSocket | undefined, detail: string): void {
    if (this.closed) return;
    this.stopTimers();
    if (!this.socketUp) this.failures++;
    this.socketUp = false;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      this.socket = undefined;
    }
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.partial.clear();
    this.partialBytes = 0;
    this.opts.log.log('relay', `socket ended: ${detail}`);
    this.peerLeft(detail);
    const delay = this.pauseMs > 0 ? this.pauseMs : this.retry * (1 + Math.random() * 0.25);
    this.pauseMs = 0;
    this.retry = Math.min(this.retry * 2, this.failures >= SLOW_AFTER_FAILURES ? SLOW_RETRY_MS : (this.opts.maxRetryMs ?? 15_000));
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private stopTimers(): void {
    clearTimeout(this.connectTimer);
    clearInterval(this.keepaliveTimer);
    clearTimeout(this.pongTimer);
    this.keepaliveTimer = undefined;
    this.pongTimer = undefined;
  }

  /** The relay's cap was reached: stop sending, tell the owner, and try again much later. */
  private limitHit(reason: 'day' | 'rate' | 'service'): void {
    if (this.pauseMs > 0) return;
    this.opts.log.log('relay', reason === 'day' ? 'relay: the daily data limit for this account is reached' : reason === 'service' ? "relay: Yak's daily relay allowance is used up" : 'relay: sending too fast, paused');
    this.events.onLimit?.(reason);
    this.pauseMs = reason === 'rate' ? RATE_RETRY_MS : LIMIT_RETRY_MS;
    this.dropped(this.socket, reason === 'rate' ? 'rate limit' : 'daily limit');
  }

  private peerLeft(reason: string): void {
    if (!this.peerHere) return;
    this.peerHere = false;
    this.events.onClose(reason);
  }

  private peerArrived(): void {
    if (this.peerHere) this.peerLeft('other device restarted');
    this.peerHere = true;
    this.opts.log.log('relay', 'other device is on the relay');
    this.events.onOpen();
  }

  // ---- frames ----------------------------------------------------------------------------------

  private async onFrame(data: unknown): Promise<void> {
    if (typeof data === 'string') {
      if (data === 'pong') return;
      try {
        const frame = JSON.parse(data) as { event?: unknown; reason?: unknown };
        if (frame.event === 'left') this.peerLeft('other device left the relay');
        else if (frame.event === 'limit') this.limitHit(frame.reason === 'rate' ? 'rate' : frame.reason === 'service' ? 'service' : 'day');
      } catch {
        // Not ours.
      }
      return;
    }
    if (!(data instanceof ArrayBuffer) || data.byteLength === 0) return;
    const frame = new Uint8Array(data);
    try {
      if (frame[0] === HELLO) {
        await this.unseal('hello', frame.subarray(1));
        await this.sendControl(ACK);
        this.peerArrived();
      } else if (frame[0] === ACK) {
        await this.unseal('ack', frame.subarray(1));
        if (!this.peerHere) this.peerArrived();
      } else if (frame[0] === PIECE && this.peerHere) {
        await this.onPiece(frame);
      }
    } catch {
      this.opts.log.log('relay', 'dropped a frame: could not authenticate');
    }
  }

  private async onPiece(frame: Uint8Array): Promise<void> {
    if (frame.length < PIECE_HEADER) return;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const id = view.getUint32(1);
    const index = view.getUint16(5);
    const count = view.getUint16(7);
    if (count === 0 || index >= count) return;
    const body = frame.slice(PIECE_HEADER);
    let sealed: Uint8Array;
    if (count === 1) {
      sealed = body;
    } else {
      let entry = this.partial.get(id);
      if (!entry) {
        if (this.partial.size >= MAX_PARTIAL_MESSAGES) this.dropOldestPartial();
        entry = { count, parts: new Map(), bytes: 0 };
        this.partial.set(id, entry);
      }
      if (entry.count !== count || entry.parts.has(index)) return;
      entry.parts.set(index, body);
      entry.bytes += body.length;
      this.partialBytes += body.length;
      while (this.partialBytes > MAX_PARTIAL_BYTES) this.dropOldestPartial();
      if (entry.parts.size < count) return;
      this.partial.delete(id);
      this.partialBytes -= entry.bytes;
      sealed = new Uint8Array(entry.bytes);
      let at = 0;
      for (let i = 0; i < count; i++) {
        const part = entry.parts.get(i);
        if (!part) return;
        sealed.set(part, at);
        at += part.length;
      }
    }
    this.events.onMessage(await this.unseal('data', sealed));
  }

  private dropOldestPartial(): void {
    const oldest = this.partial.keys().next().value;
    if (oldest === undefined) return;
    this.partialBytes -= this.partial.get(oldest)?.bytes ?? 0;
    this.partial.delete(oldest);
  }

  private async sendControl(kind: typeof HELLO | typeof ACK): Promise<void> {
    const sealed = await this.seal(kind === HELLO ? 'hello' : 'ack', new Uint8Array(0));
    // Control frames are rare and small; they skip the pacer.
    try {
      if (this.socketUp) this.socket?.send(concat(Uint8Array.of(kind), sealed));
    } catch {
      // The socket is ending; its handlers deal with it.
    }
  }

  /** Sends queued frames while the pacer has tokens, else waits for more. */
  private pump(): void {
    if (this.closed || !this.socketUp || !this.socket) return;
    const now = Date.now();
    const dt = (now - this.refilledAt) / 1000;
    this.refilledAt = now;
    this.byteTokens = Math.min(BYTES_BURST, this.byteTokens + dt * BYTES_PER_SECOND);
    this.frameTokens = Math.min(FRAMES_BURST, this.frameTokens + dt * FRAMES_PER_SECOND);
    while (this.queue.length > 0) {
      const frame = this.queue[0];
      if (!frame || this.frameTokens < 1 || this.byteTokens < frame.length || this.socket.bufferedAmount > 512 * 1024) break;
      try {
        this.socket.send(frame as unknown as ArrayBufferView<ArrayBuffer>);
      } catch {
        return;
      }
      this.queue.shift();
      this.queuedBytes -= frame.length;
      this.byteTokens -= frame.length;
      this.frameTokens -= 1;
    }
    if (this.queue.length > 0 && this.pumpTimer === undefined) {
      this.pumpTimer = setTimeout(() => {
        this.pumpTimer = undefined;
        this.pump();
      }, 100);
    }
  }

  // ---- sealing ---------------------------------------------------------------------------------

  private aad(kind: string): BufferSource {
    return new TextEncoder().encode(`${RELAY_CONTEXT_PREFIX}${this.context}:${kind}`);
  }

  /** `nonce || ciphertext`. */
  private async seal(kind: string, plain: Uint8Array): Promise<Uint8Array> {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: this.aad(kind) }, this.sendKey, plain as BufferSource),
    );
    return concat(nonce, ciphertext);
  }

  private async unsealWith(key: CryptoKey, kind: string, sealed: Uint8Array): Promise<Uint8Array> {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.slice(0, NONCE_BYTES) as BufferSource, additionalData: this.aad(kind) },
      key,
      sealed.slice(NONCE_BYTES) as BufferSource,
    );
    return new Uint8Array(plain);
  }

  private pairFailed(why: string): void {
    this.pairOff = true;
    this.opts.log.log('relay', `warning: ${why}; using the shared key on this link`);
    this.events.onPairFailed?.();
  }

  private async unseal(kind: string, sealed: Uint8Array): Promise<Uint8Array> {
    if (sealed.length <= NONCE_BYTES) throw new Error('too short');
    const pair = this.opts.pair;
    if (!pair || this.pairOff) return this.unsealWith(this.opts.key, kind, sealed);
    try {
      const plain = await this.unsealWith(pair.key, kind, sealed);
      this.sendKey = pair.key;
      return plain;
    } catch (e) {
      if (pair.only) throw e;
    }
    let plain: Uint8Array;
    try {
      plain = await this.unsealWith(this.opts.key, kind, sealed);
    } catch (e) {
      // Neither key opens it: the two ends derived different pair keys. Fall back and say hello again with the shared key.
      if (this.sendKey !== this.opts.key) {
        this.sendKey = this.opts.key;
        this.pairFailed('could not open a frame with the pair key');
        void this.sendControl(HELLO);
      }
      throw e;
    }
    if (this.sendKey !== this.opts.key) {
      this.sendKey = this.opts.key;
      this.pairFailed('other device seals with the shared key');
    }
    return plain;
  }
}
