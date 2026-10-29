import type { LinkState } from './types';

/**
 * The two levels of status (docs/sync.md).
 * Never mixed: the header chip and the top of the Devices page describe THIS device; each device row
 * describes ONE OTHER device.
 */

export interface DeviceStatus {
  /** Short text for the header chip. */
  label: string;
  /** A sentence for the Devices page. */
  hint: string;
  /** Picks the dot colour (the same dots the rows use). */
  dot: LinkState;
}

export interface DeviceStatusInput {
  paired: boolean;
  online: boolean;
  /** The connection server (signaling) has been unreachable for several seconds. */
  signalingProblem: boolean;
  /** The other devices of the account, with their link states. */
  peers: readonly { state: LinkState; via?: 'direct' | 'relay' }[];
  /** Another tab of this browser runs sync; the states are that tab's. */
  otherTab?: boolean;
}

const OTHER_TAB = ' Another tab of this browser does the syncing; changes made here go through it.';

export function deviceStatus(s: DeviceStatusInput): DeviceStatus {
  const status = ownStatus(s);
  if (!s.otherTab || !s.paired) return status;
  return { ...status, label: status.dot === 'connected' ? status.label.replace('Syncing', 'Syncing in another tab') : status.label, hint: status.hint + OTHER_TAB };
}

function ownStatus(s: DeviceStatusInput): DeviceStatus {
  if (!s.paired) return { label: 'Not syncing', dot: 'stopped', hint: 'This device is not in an account of synced devices: it keeps its data to itself.' };
  if (!s.online) return { label: 'Offline', dot: 'stopped', hint: 'No network. Everything still works and saves here; syncing resumes when the network is back.' };
  if (s.signalingProblem) {
    return {
      label: "Can't reach the connection server",
      dot: 'reconnecting',
      hint: 'The network is up but the server that introduces your devices to each other is not answering. This device keeps trying. Devices already linked keep syncing.',
    };
  }
  const total = s.peers.length;
  const linked = s.peers.filter((p) => p.state === 'connected').length;
  if (linked > 0) {
    // Names the path when every link goes through the relay (S-75); a mix of paths reads as plain syncing.
    const relayOnly = s.peers.filter((p) => p.state === 'connected').every((p) => p.via === 'relay');
    return relayOnly
      ? { label: `Syncing through the relay · ${linked} of ${total}`, dot: 'connected', hint: 'Changes reach the linked devices at once, through the relay: slower, and without attachments.' }
      : { label: `Syncing · ${linked} of ${total}`, dot: 'connected', hint: 'Changes reach the linked devices at once.' };
  }
  if (total === 0) return { label: 'No other devices', dot: 'waiting-for-peer', hint: 'No other devices yet. Add one below.' };
  // The same words as the device rows: a device is Connecting… while a link is being made, Waiting while it is not open.
  if (s.peers.some((p) => p.state === 'connecting' || p.state === 'reconnecting')) {
    return { label: 'Connecting…', dot: 'connecting', hint: 'Linking to your other devices. This takes a few seconds.' };
  }
  return { label: 'Waiting', dot: 'waiting-for-peer', hint: 'Waiting for your other devices to open Yak. Each links by itself as soon as it does.' };
}

/** One other device: what its row says. The shape beside it comes from `linkKind` (app/sync-state.ts). */
export function peerStatus(state: LinkState, via?: 'direct' | 'relay'): { label: string } {
  switch (state) {
    case 'connected':
      return { label: via === 'relay' ? 'Syncing through the relay' : 'Syncing directly' };
    case 'connecting':
    case 'reconnecting':
      return { label: 'Connecting…' };
    case 'waiting-for-peer':
      return { label: 'Waiting' };
    default:
      return { label: 'Stopped' };
  }
}
