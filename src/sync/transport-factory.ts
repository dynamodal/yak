import { NtfyTransport, type SignalingTransport } from './signaling';
import { WebSocketTransport, siteRelayUrl } from './signaling-ws';
import type { RoomKind } from '../core/protocol-ids';

/** Public ntfy: the alternative signaling server, and the app's default until October 2026. */
export const NTFY_SIGNALING_URL = 'https://ntfy.sh';

/**
 * The default signaling server: this site's own relay (`wss://<this host>/signal`). Outside a page,
 * as in unit tests, there is no site, so ntfy.
 */
export function defaultSignalingUrl(): string {
  return globalThis.location?.host ? siteRelayUrl() : NTFY_SIGNALING_URL;
}

export const isRelayUrl = (url: string): boolean => /^wss?:\/\//i.test(url.trim());

/**
 * Pick a signaling backend from the setting: `ws://` or `wss://` is a relay, anything else is ntfy; empty is the default.
 * `kind` tells the relay what the room is for (#109); ntfy gets nothing.
 */
export function createTransport(url: string, kind?: RoomKind): SignalingTransport {
  const trimmed = url.trim() || defaultSignalingUrl();
  if (isRelayUrl(trimmed)) return new WebSocketTransport({ baseUrl: trimmed, ...(kind ? { kind } : {}) });
  return new NtfyTransport({ baseUrl: trimmed });
}
