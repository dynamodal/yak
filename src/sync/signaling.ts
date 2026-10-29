/**
 * "Put an encrypted message in mailbox X; watch mailbox X." The adapter interface the plan
 * calls for, so ntfy, a GitHub repo or a self-hosted relay are interchangeable. Messages are
 * opaque text: encryption lives above this layer and is identical for every backend.
 */

import type { RelayRefusal } from './relay-refusal';

export interface InboxMessage {
  /** Backend message id, usable to resume after a gap. */
  id: string;
  /** Seconds since the epoch, from the server. */
  time: number;
  message: string;
}

export interface SubscribeHandlers {
  onMessage(message: InboxMessage): void;
  /** The watch started or stopped; the adapter reconnects by itself after `disconnected`. */
  onStatus?(status: 'connected' | 'disconnected', detail?: string): void;
  /** Anything arrived on the watch, including keepalives: the stream is alive. Server time in seconds, when known. */
  onActivity?(serverTime?: number): void;
  /** The relay closed the connection saying this network is over a limit (see relay-refusal.ts). Follows `disconnected`. */
  onRefused?(refusal: RelayRefusal): void;
}

export interface SubscribeOptions {
  /** Where to start on the first connect: a duration such as `5m`, or a message id. */
  since?: string;
}

/** The signaling server refused a publish because this network sent too many requests. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs?: number) {
    super('signaling server is rate-limiting this network (HTTP 429)');
    this.name = 'RateLimitedError';
  }
}

export interface SignalingTransport {
  publish(mailbox: string, message: string): Promise<void>;
  /** Returns a function that stops watching. */
  subscribe(mailbox: string, handlers: SubscribeHandlers, options?: SubscribeOptions): () => void;
}

export interface NtfyOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Delay before reconnecting after the stream ends: starts here, doubles, capped at maxRetryMs. */
  retryMs?: number;
  maxRetryMs?: number;
  /**
   * After a stream connects, read the cache once more after this delay. ntfy writes its cache in
   * batches, so a message published a moment before a subscriber connected can be missing from
   * the replay and was never seen live. 0 disables the extra read.
   */
  catchUpDelayMs?: number;
  /** Minimum wait after the server answers 429 Too Many Requests. */
  rateLimitedRetryMs?: number;
}

interface NtfyEvent {
  id?: string;
  time?: number;
  event?: string;
  message?: string;
}

/**
 * ntfy as a mailbox: POST to publish, a Server-Sent-Events stream to watch. The stream is read
 * with `fetch` rather than `EventSource` so that the resume point (`since=<last id>`) can change
 * on each reconnect and so the same code runs in tests. A topic on ntfy is a password: callers
 * must pass an unguessable name and encrypt every message.
 */
export class NtfyTransport implements SignalingTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retryMs: number;
  private readonly maxRetryMs: number;
  private readonly catchUpDelayMs: number;
  private readonly rateLimitedRetryMs: number;

  constructor(options: NtfyOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://ntfy.sh').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.retryMs = options.retryMs ?? 1000;
    this.maxRetryMs = options.maxRetryMs ?? 15_000;
    this.catchUpDelayMs = options.catchUpDelayMs ?? 2000;
    this.rateLimitedRetryMs = options.rateLimitedRetryMs ?? 30_000;
  }

  async publish(mailbox: string, message: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/${encodeURIComponent(mailbox)}`, {
      method: 'POST',
      body: message,
    });
    if (response.status === 429) {
      const after = Number(response.headers.get('retry-after'));
      throw new RateLimitedError(after > 0 ? after * 1000 : undefined);
    }
    if (!response.ok) throw new Error(`ntfy publish failed: HTTP ${response.status}`);
  }

  subscribe(mailbox: string, handlers: SubscribeHandlers, options: SubscribeOptions = {}): () => void {
    const controller = new AbortController();
    let lastId: string | undefined;
    let retry = this.retryMs;
    const delivered = new Set<string>();

    /** Deliver each message once, whichever of the stream or a catch-up read sees it first. */
    const deliver = (event: NtfyEvent): void => {
      handlers.onActivity?.(event.time);
      if (event.event !== 'message' || typeof event.message !== 'string' || !event.id) return;
      lastId = event.id;
      if (delivered.has(event.id)) return;
      delivered.add(event.id);
      if (delivered.size > 500) {
        const oldest = delivered.values().next().value;
        if (oldest !== undefined) delivered.delete(oldest);
      }
      handlers.onMessage({ id: event.id, time: event.time ?? 0, message: event.message });
    };

    const catchUp = async (since: string): Promise<void> => {
      try {
        const response = await this.fetchImpl(
          `${this.baseUrl}/${encodeURIComponent(mailbox)}/json?poll=1&since=${encodeURIComponent(since)}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        for (const line of (await response.text()).split('\n')) {
          if (!line.trim()) continue;
          try {
            deliver(JSON.parse(line) as NtfyEvent);
          } catch {
            // A malformed line is skipped.
          }
        }
      } catch {
        // The stream is the primary path; a failed catch-up read is not an error.
      }
    };

    const run = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        const since = lastId ?? options.since ?? '5m';
        let catchUpTimer: ReturnType<typeof setTimeout> | undefined;
        let rateLimited = false;
        try {
          const response = await this.fetchImpl(
            `${this.baseUrl}/${encodeURIComponent(mailbox)}/sse?since=${encodeURIComponent(since)}`,
            { signal: controller.signal, headers: { Accept: 'text/event-stream' } },
          );
          if (response.status === 429) {
            rateLimited = true;
            const after = Number(response.headers.get('retry-after'));
            if (after > 0) retry = Math.max(retry, after * 1000);
          }
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
          handlers.onStatus?.('connected');
          retry = this.retryMs;
          if (this.catchUpDelayMs > 0) {
            catchUpTimer = setTimeout(() => void catchUp(lastId ?? since), this.catchUpDelayMs);
          }
          await this.readStream(response.body, deliver);
          if (!controller.signal.aborted) handlers.onStatus?.('disconnected', 'stream ended');
        } catch (error) {
          if (controller.signal.aborted) return;
          handlers.onStatus?.('disconnected', error instanceof Error ? error.message : String(error));
        } finally {
          clearTimeout(catchUpTimer);
        }
        if (controller.signal.aborted) return;
        // Over the request budget, retrying fast only spends what is left; wait for it to refill.
        if (rateLimited) retry = Math.max(retry, this.rateLimitedRetryMs);
        await new Promise((resolve) => setTimeout(resolve, retry));
        retry = rateLimited ? retry : Math.min(retry * 2, this.maxRetryMs);
      }
    };
    void run();
    return () => controller.abort();
  }

  /** Parse an SSE body: events are blocks separated by a blank line, with `data:` lines. */
  private async readStream(body: ReadableStream<Uint8Array>, onEvent: (event: NtfyEvent) => void): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) {
          try {
            onEvent(JSON.parse(data) as NtfyEvent);
          } catch {
            // A malformed event is skipped; the stream continues.
          }
        }
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }
  }
}
