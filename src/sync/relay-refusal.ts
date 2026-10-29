/**
 * How the relay says "not now" (worker/index.ts). A browser hides the status of a refused
 * WebSocket handshake, so the Worker accepts the upgrade and closes at once with a custom code
 * (4000 to 4999 is for applications) and a short reason, which `CloseEvent` does expose:
 *
 *   4429  `rate retry=<seconds>`                    too many connections a minute from this network
 *   4430  `day scope=share|topics reset=<unix s>`   this network's share of the day is spent
 *
 * Keep in step with worker/index.ts. Anything else that ends a socket is a plain drop.
 */
export const RELAY_CLOSE_RATE = 4429;
export const RELAY_CLOSE_DAY = 4430;

export interface RelayRefusal {
  kind: 'rate' | 'day';
  /** `day` only: which daily limit (the share of requests, or the number of different accounts). */
  scope?: 'share' | 'topics';
  /** How long to open no connections: the relay's retry time, kept within sane bounds. */
  retryMs: number;
  /** `day` only: unix seconds when the relay starts a new day. */
  resetsAt?: number;
}

const MIN_PAUSE_MS = 5000;
const DEFAULT_RATE_PAUSE_MS = 60_000;
/** A daily refusal is retried this often at most, so a long wait to the reset never means silence for hours. */
const MAX_PAUSE_MS = 30 * 60_000;

const field = (reason: string, name: string): string | undefined => new RegExp(`(?:^|\\s)${name}=(\\S+)`).exec(reason)?.[1];

/** The refusal a close carries, or undefined for any other close. */
export function parseRelayRefusal(code: number, reason: string, now: number = Date.now()): RelayRefusal | undefined {
  if (code === RELAY_CLOSE_RATE) {
    const retry = Number(field(reason, 'retry'));
    const ms = Number.isFinite(retry) && retry > 0 ? retry * 1000 : DEFAULT_RATE_PAUSE_MS;
    return { kind: 'rate', retryMs: Math.min(Math.max(ms, MIN_PAUSE_MS), MAX_PAUSE_MS) };
  }
  if (code === RELAY_CLOSE_DAY) {
    const reset = Number(field(reason, 'reset'));
    const scope = field(reason, 'scope') === 'topics' ? 'topics' : 'share';
    const wait = Number.isFinite(reset) && reset > 0 ? reset * 1000 - now : MAX_PAUSE_MS;
    return { kind: 'day', scope, retryMs: Math.min(Math.max(wait, MIN_PAUSE_MS), MAX_PAUSE_MS), ...(Number.isFinite(reset) && reset > 0 ? { resetsAt: reset } : {}) };
  }
  return undefined;
}
