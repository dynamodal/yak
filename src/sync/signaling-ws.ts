import { parseRelayRefusal, type RelayRefusal } from './relay-refusal';
import { RateLimitedError, type InboxMessage, type SignalingTransport, type SubscribeHandlers } from './signaling';

/**
 * Signaling over a WebSocket relay (the Worker in `worker/`, or any server that speaks the same
 * small protocol). One socket per mailbox carries both directions:
 *
 *   server -> client on connect: {"event":"open","time":<server unix seconds>}
 *   client -> server:            the message text as is; the text `ping` is answered `pong`
 *   server -> other sockets:     {"id":"<unique>","time":<server unix seconds>,"message":"<text>"}
 *
 * The server never echoes a message to its sender and keeps nothing, so a device that was absent
 * learns of its peer from the peer's next announcement (see docs/sync.md). Messages are
 * opaque text: encryption lives above this layer and is identical for every backend.
 */

/** Largest message the relay accepts, in UTF-8 bytes. Keep in step with worker/index.ts. */
export const MAX_RELAY_MESSAGE_BYTES = 8 * 1024;

export interface WebSocketTransportOptions {
  /** `wss://host/signal` (a path the mailbox name is appended to). Default: this site's `/signal`. */
  baseUrl?: string;
  /** For tests and non-browser use. Default: the global `WebSocket`. */
  WebSocketImpl?: typeof WebSocket;
  /** Delay before reconnecting: starts here, doubles, capped at `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
  /** Send `ping` this often while connected; the relay answers `pong`. 0 disables. Default 50 s. */
  keepaliveMs?: number;
  /** A ping with no frame back within this long means the socket is dead: drop it and reconnect. */
  pongTimeoutMs?: number;
  /** A socket still connecting after this long is abandoned and retried. */
  connectTimeoutMs?: number;
  /** A connection that stayed up this long resets the backoff when it ends. */
  stableMs?: number;
  /** A publish still waiting for a connection after this long fails. */
  publishTimeoutMs?: number;
}

/** `wss://<this host>/signal` (or `ws://` on plain HTTP, for local runs), from a page location. */
export function siteRelayUrl(loc: Pick<Location, 'protocol' | 'host'> = globalThis.location): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/signal`;
}

export function toWebSocketUrl(url: string): string {
  return url.replace(/^http(s?):\/\//i, (_, s: string) => `ws${s}://`).replace(/\/+$/, '');
}

interface PendingPublish {
  text: string;
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class WebSocketTransport implements SignalingTransport {
  private readonly baseUrl: string;
  private readonly impl: typeof WebSocket | undefined;
  private readonly retryMs: number;
  private readonly maxRetryMs: number;
  private readonly keepaliveMs: number;
  private readonly pongTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly stableMs: number;
  private readonly publishTimeoutMs: number;
  private readonly channels = new Map<string, Channel>();

  constructor(options: WebSocketTransportOptions = {}) {
    this.baseUrl = toWebSocketUrl(options.baseUrl ?? siteRelayUrl());
    this.impl = options.WebSocketImpl ?? (typeof WebSocket === 'undefined' ? undefined : WebSocket);
    this.retryMs = options.retryMs ?? 1000;
    this.maxRetryMs = options.maxRetryMs ?? 15_000;
    this.keepaliveMs = options.keepaliveMs ?? 50_000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 10_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
    this.stableMs = options.stableMs ?? 5000;
    this.publishTimeoutMs = options.publishTimeoutMs ?? 15_000;
  }

  publish(mailbox: string, message: string): Promise<void> {
    if (new TextEncoder().encode(message).byteLength > MAX_RELAY_MESSAGE_BYTES) {
      return Promise.reject(new Error(`signaling message is larger than ${MAX_RELAY_MESSAGE_BYTES} bytes`));
    }
    const channel = this.channel(mailbox);
    if (!channel) return Promise.reject(new Error('WebSocket is not available in this browser'));
    return channel.publish(message);
  }

  subscribe(mailbox: string, handlers: SubscribeHandlers): () => void {
    const channel = this.channel(mailbox);
    if (!channel) {
      handlers.onStatus?.('disconnected', 'WebSocket is not available in this browser');
      return () => {};
    }
    return channel.addSubscriber(handlers);
  }

  /** The shared channel for a mailbox, created on first use. */
  private channel(mailbox: string): Channel | undefined {
    if (!this.impl) return undefined;
    let channel = this.channels.get(mailbox);
    if (!channel) {
      const impl = this.impl;
      channel = new Channel({
        url: `${this.baseUrl}/${encodeURIComponent(mailbox)}`,
        create: (url) => new impl(url),
        retryMs: this.retryMs,
        maxRetryMs: this.maxRetryMs,
        keepaliveMs: this.keepaliveMs,
        pongTimeoutMs: this.pongTimeoutMs,
        connectTimeoutMs: this.connectTimeoutMs,
        stableMs: this.stableMs,
        publishTimeoutMs: this.publishTimeoutMs,
        onDestroy: () => {
          if (this.channels.get(mailbox) === channel) this.channels.delete(mailbox);
        },
      });
      this.channels.set(mailbox, channel);
    }
    return channel;
  }
}

interface ChannelConfig {
  url: string;
  create(url: string): WebSocket;
  retryMs: number;
  maxRetryMs: number;
  keepaliveMs: number;
  pongTimeoutMs: number;
  connectTimeoutMs: number;
  stableMs: number;
  publishTimeoutMs: number;
  onDestroy(): void;
}

/** One mailbox: one socket, reconnected with backoff while anyone subscribes or publishes. */
class Channel {
  private socket: WebSocket | undefined;
  private isOpen = false;
  private destroyed = false;
  private started = false;
  private openedAt = 0;
  private retry: number;
  /** Attempts in a row that never opened; each costs the relay a request, so the wait grows. */
  private failures = 0;
  private readonly subscribers = new Set<SubscribeHandlers>();
  private readonly queue: PendingPublish[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly cfg: ChannelConfig) {
    this.retry = cfg.retryMs;
  }

  addSubscriber(handlers: SubscribeHandlers): () => void {
    this.subscribers.add(handlers);
    if (this.isOpen) {
      handlers.onStatus?.('connected');
      handlers.onActivity?.();
    }
    this.start();
    return () => {
      if (!this.subscribers.delete(handlers)) return;
      // The last watcher leaving ends the socket. A caller that unsubscribes and subscribes again
      // therefore gets a fresh connection, which is what "restart the stream" means.
      if (this.subscribers.size === 0) this.destroy('unsubscribed');
    };
  }

  publish(text: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.destroyed) {
        reject(new Error('signaling connection closed'));
        return;
      }
      if (this.isOpen && this.socket) {
        try {
          this.socket.send(text);
          resolve();
          this.settle();
        } catch (e) {
          reject(new Error(`signaling send failed: ${errorText(e)}`));
        }
        return;
      }
      const entry: PendingPublish = {
        text,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new Error('signaling connection not available'));
          this.settle();
        }, this.cfg.publishTimeoutMs),
      };
      this.queue.push(entry);
      this.start();
    });
  }

  /** Connect on first use, once someone is there to be told how it went. */
  private start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;
    clearTimeout(this.retryTimer);
    let socket: WebSocket;
    try {
      socket = this.cfg.create(this.cfg.url);
    } catch (e) {
      this.dropped(undefined, `could not open: ${errorText(e)}`);
      return;
    }
    this.socket = socket;
    // Events from a socket that has been replaced are ignored.
    const current = (): boolean => this.socket === socket && !this.destroyed;
    this.connectTimer = setTimeout(() => {
      if (current() && !this.isOpen) this.dropped(socket, 'connect timed out');
    }, this.cfg.connectTimeoutMs);
    socket.onopen = () => {
      if (!current()) return;
      clearTimeout(this.connectTimer);
      this.isOpen = true;
      this.failures = 0;
      this.openedAt = Date.now();
      this.each((h) => h.onStatus?.('connected'));
      this.each((h) => h.onActivity?.());
      this.startKeepalive(socket);
      const queued = this.queue.splice(0);
      for (const entry of queued) {
        clearTimeout(entry.timer);
        try {
          socket.send(entry.text);
          entry.resolve();
        } catch (e) {
          entry.reject(new Error(`signaling send failed: ${errorText(e)}`));
        }
      }
      this.settle();
    };
    socket.onmessage = (event: MessageEvent) => {
      if (!current()) return;
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
      this.onFrame(event.data);
    };
    socket.onerror = () => {
      // Browsers give no detail and follow with a close event, but some runtimes never send it
      // for a refused handshake, so an error ends the attempt too.
      if (current()) this.dropped(socket, this.isOpen ? 'connection error' : 'could not connect');
    };
    socket.onclose = (event: CloseEvent) => {
      if (!current()) return;
      const refusal = parseRelayRefusal(event.code, event.reason);
      if (refusal) this.refused(socket, refusal);
      else this.dropped(socket, event.reason || `closed (${event.code})`);
    };
  }

  /**
   * The relay accepted the upgrade and closed at once, naming a limit. Say so to the watchers (the
   * mesh then pauses), fail waiting publishes with the retry time, and come back only after it.
   */
  private refused(socket: WebSocket, refusal: RelayRefusal): void {
    if (this.destroyed) return;
    this.dropped(socket, `refused by the relay (${refusal.kind})`, refusal);
  }

  private onFrame(data: unknown): void {
    if (typeof data !== 'string') return;
    if (data === 'pong') {
      this.each((h) => h.onActivity?.());
      return;
    }
    let frame: { event?: unknown; id?: unknown; time?: unknown; message?: unknown };
    try {
      frame = JSON.parse(data) as typeof frame;
    } catch {
      return;
    }
    if (typeof frame !== 'object' || frame === null) return;
    const time = typeof frame.time === 'number' ? frame.time : undefined;
    this.each((h) => h.onActivity?.(time));
    if (typeof frame.id === 'string' && typeof frame.message === 'string') {
      const message: InboxMessage = { id: frame.id, time: time ?? 0, message: frame.message };
      this.each((h) => h.onMessage(message));
    }
  }

  private startKeepalive(socket: WebSocket): void {
    clearInterval(this.keepaliveTimer);
    if (this.cfg.keepaliveMs <= 0) return;
    this.keepaliveTimer = setInterval(() => {
      if (this.socket !== socket || !this.isOpen) return;
      try {
        socket.send('ping');
      } catch {
        this.dropped(socket, 'ping failed');
        return;
      }
      this.pongTimer ??= setTimeout(() => {
        this.pongTimer = undefined;
        if (this.socket === socket && this.isOpen) this.dropped(socket, 'no answer to ping');
      }, this.cfg.pongTimeoutMs);
    }, this.cfg.keepaliveMs);
  }

  /** The socket ended (or never opened). Tell watchers, then retry while anyone is interested. */
  private dropped(socket: WebSocket | undefined, detail: string, refusal?: RelayRefusal): void {
    if (this.destroyed) return;
    const lived = this.isOpen ? Date.now() - this.openedAt : 0;
    if (!this.isOpen) this.failures++;
    this.stopTimers();
    this.isOpen = false;
    if (socket) {
      this.detach(socket);
      this.socket = undefined;
    }
    this.each((h) => h.onStatus?.('disconnected', detail));
    if (refusal) {
      this.each((h) => h.onRefused?.(refusal));
      if (this.destroyed) return;
      for (const entry of this.queue.splice(0)) {
        clearTimeout(entry.timer);
        entry.reject(new RateLimitedError(refusal.retryMs));
      }
    }
    if (this.subscribers.size === 0 && this.queue.length === 0) {
      this.destroy(detail);
      return;
    }
    if (lived >= this.cfg.stableMs) this.retry = this.cfg.retryMs;
    const delay = refusal ? refusal.retryMs : this.retry * (1 + Math.random() * 0.25);
    this.retry = Math.min(this.retry * 2, this.failures >= 6 ? Math.max(this.cfg.maxRetryMs, 5 * 60_000) : this.cfg.maxRetryMs);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  /** A publish-only channel has nothing left to wait for once its messages are sent. */
  private settle(): void {
    if (this.subscribers.size === 0 && this.queue.length === 0) this.destroy('done');
  }

  private destroy(reason: string): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopTimers();
    clearTimeout(this.retryTimer);
    const socket = this.socket;
    this.socket = undefined;
    this.isOpen = false;
    if (socket) {
      this.detach(socket);
      try {
        socket.close(1000, reason.slice(0, 100));
      } catch {
        // Already closed.
      }
    }
    for (const entry of this.queue.splice(0)) {
      clearTimeout(entry.timer);
      entry.reject(new Error('signaling connection closed'));
    }
    this.cfg.onDestroy();
  }

  private detach(socket: WebSocket): void {
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    if (!this.destroyed) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
  }

  private stopTimers(): void {
    clearTimeout(this.connectTimer);
    clearInterval(this.keepaliveTimer);
    clearTimeout(this.pongTimer);
    this.keepaliveTimer = undefined;
    this.pongTimer = undefined;
  }

  private each(fn: (handlers: SubscribeHandlers) => void): void {
    for (const handlers of [...this.subscribers]) {
      try {
        fn(handlers);
      } catch {
        // One faulty watcher must not stop the others.
      }
    }
  }
}
