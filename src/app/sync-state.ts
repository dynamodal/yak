import type { LinkState } from '../sync/types';

/**
 * The header's sync control shows one of four shapes (F-33h). Shape as well as colour, so the state
 * never depends on colour alone:
 * - `off`: grey square. Sync is off, or on but no other device is paired yet.
 * - `direct`: filled accent circle. Paired and linked to at least one device directly.
 * - `relay`: accent ring. Linked to a device, but only through the relay.
 * - `offline`: amber triangle. Paired, and no device is linked now.
 */
export type SyncShape = 'off' | 'direct' | 'relay' | 'offline';

export interface SyncShapeInput {
  paired: boolean;
  /** The other devices the person can still sync with (removed and left ones are already left out). */
  peers: readonly { state: LinkState; via?: 'direct' | 'relay' }[];
}

/**
 * Maps the sync service's state to a shape. A device with a pairing but no other device yet is `off`
 * (nothing to sync with). A linked peer that reports no path counts as direct (the nearest state: the
 * relay is only used when the direct path failed, and it says so).
 */
export function syncShape(s: SyncShapeInput): SyncShape {
  if (!s.paired || s.peers.length === 0) return 'off';
  const linked = s.peers.filter((p) => p.state === 'connected');
  if (linked.length === 0) return 'offline';
  return linked.some((p) => p.via !== 'relay') ? 'direct' : 'relay';
}

export interface SyncShapeText {
  /** Visible on a wide screen, and the start of the accessible name. */
  label: string;
  /** The rest of the accessible name. */
  detail: string;
}

export const SYNC_SHAPE_TEXT: Readonly<Record<SyncShape, SyncShapeText>> = {
  off: { label: 'Sync off', detail: 'this device is not syncing with another device' },
  direct: { label: 'Synced', detail: 'linked to another device directly' },
  relay: { label: 'Via relay', detail: 'linked to another device only through the relay' },
  offline: { label: 'Not connected', detail: 'paired, but no other device is linked now' },
};

/**
 * The shape for the overall status lines (Settings and Add a device): the header's rule, except that no network is
 * never drawn as linked, whatever the peers last said.
 */
export function overallShape(s: SyncShapeInput & { online: boolean }): SyncShape {
  const shape = syncShape(s);
  return !s.online && shape !== 'off' ? 'offline' : shape;
}

/** How one other device is linked, in the sync popover. */
export type LinkKind = 'direct' | 'relay' | 'connecting' | 'none';

export function linkKind(p: { state: LinkState; via?: 'direct' | 'relay' }): LinkKind {
  if (p.state === 'connected') return p.via === 'relay' ? 'relay' : 'direct';
  return p.state === 'connecting' || p.state === 'reconnecting' ? 'connecting' : 'none';
}

export const LINK_KIND_LABEL: Readonly<Record<LinkKind, string>> = {
  direct: 'Direct',
  relay: 'Via relay',
  connecting: 'Connecting…',
  none: 'Not connected',
};

/**
 * The shape for one other device's row. Connecting and not linked both use the triangle (the header's "paired, nothing
 * linked"); the row's words say which. A device that is not syncing at all uses the square.
 */
export function linkShape(kind: LinkKind): SyncShape {
  return kind === 'direct' ? 'direct' : kind === 'relay' ? 'relay' : 'offline';
}
