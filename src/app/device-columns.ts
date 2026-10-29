import type * as Y from 'yjs';
import { useApp } from './context';
import { useSyncStatus, useYVersion } from './hooks';
import { useKeyTrust } from './key-hooks';
import { devicesMap, deviceName, readDevices } from '../core/devices';
import { keepsMap } from '../core/keeps';
import type { PeerInfo } from '../sync/peer-mesh';

const shortId = (id: string): string => id.slice(0, 8);

export interface Column {
  id: string;
  /** Header text. */
  label: string;
  /** Used in checkbox names: "This device keeps Work". */
  who: string;
  here: boolean;
  /** The link to that device as the sync layer sees it (not for this device). */
  peer?: PeerInfo;
}

/** This device first, then the account's other devices that are not removed or left (F-326b): the device rows of Settings and the chips of a space row (Kept on). */
export function useDeviceColumns(): { columns: Column[]; localOnly: boolean } {
  const { account, deviceId, sync } = useApp();
  const status = useSyncStatus(sync);
  const trust = useKeyTrust();
  useYVersion(devicesMap(account) as unknown as Y.AbstractType<unknown>);
  useYVersion(keepsMap(account) as unknown as Y.AbstractType<unknown>);
  const devices = readDevices(account);
  const isOut = (id: string): boolean => trust.blocked(id, devices.get(id)?.removed === true);
  const peers = status.peers.filter((p) => !isOut(p.id) && !devices.get(p.id)?.left);
  const columns: Column[] = [
    { id: deviceId, label: 'This device', who: 'This device', here: true },
    ...peers.map((p): Column => {
      const name = deviceName(account, p.id) ?? shortId(p.id);
      return { id: p.id, label: name, who: name, here: false, peer: p };
    }),
  ];
  return { columns, localOnly: !status.paired && peers.length === 0 };
}

/** "connected now", "last seen 3 Oct, 10:14" or "not seen yet". */
export function lastSeen(peer: PeerInfo | undefined): string {
  if (!peer) return '';
  if (peer.state === 'connected') return 'connected now';
  const at = peer.lastConnectedAt ?? peer.lastSeenAt;
  return at ? `last seen ${new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'not seen yet';
}
