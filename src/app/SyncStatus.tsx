import type { ComponentType } from 'preact';
import type * as Y from 'yjs';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { deviceName, devicesMap, readDevices } from '../core/devices';
import { deviceStatus } from '../sync/device-status';
import type { PeerInfo } from '../sync/peer-mesh';
import { useApp } from './context';
import { useHealth, useOnline, useSyncStatus, useYVersion } from './hooks';
import { useKeyTrust } from './key-hooks';
import { LINK_KIND_LABEL, linkKind, SYNC_SHAPE_TEXT, type SyncShape, syncShape } from './sync-state';
import { IconChevronDown, Pill, IconSyncDirect, IconSyncOff, IconSyncOffline, IconSyncRelay, Popover } from './ui';
import { cx } from './ui/cx';

const SHAPE_ICON: Record<SyncShape, ComponentType> = {
  off: IconSyncOff,
  direct: IconSyncDirect,
  relay: IconSyncRelay,
  offline: IconSyncOffline,
};

const isError = (e: { kind: string }): boolean => e.kind === 'error' || e.kind.startsWith('error:');
const shortId = (id: string): string => id.slice(0, 8);

/** The other devices this person still syncs with: not removed (or blocked) and not left (the same rule as the Devices page). */
function useOtherDevices(): PeerInfo[] {
  const { account, sync } = useApp();
  const status = useSyncStatus(sync);
  const trust = useKeyTrust();
  useYVersion(devicesMap(account) as unknown as Y.AbstractType<unknown>);
  const devices = readDevices(account);
  return status.peers.filter((p) => !trust.blocked(p.id, devices.get(p.id)?.removed === true) && !devices.get(p.id)?.left);
}

function lastConnected(p: PeerInfo): string {
  const at = p.lastConnectedAt ?? p.lastSeenAt;
  return at ? `last connected ${new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'not connected yet';
}

export interface SyncStatusProps {
  /** Merges worth a look (`core/notices.ts`), listed under "Other". */
  pendingNotices: number;
}

/**
 * The header's sync control (F-33h): a button whose shape and colour say how this device syncs, and a popover with
 * the devices and how each is linked. What other modules report through `core/health.ts` (a stale backup) is listed
 * under "Other" in the same popover; the Settings tab carries a dot when one of them is a warning.
 */
export function SyncStatus({ pendingNotices }: SyncStatusProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { sync, account } = useApp();
  const status = useSyncStatus(sync);
  const online = useOnline();
  const peers = useOtherDevices();
  const health = useHealth();
  const [errors, setErrors] = useState(() => sync.log.all().some(isError));
  useEffect(() => sync.log.subscribe((e) => isError(e) && setErrors(true)), [sync]);

  const shape = syncShape({ paired: status.paired, peers });
  const text = SYNC_SHAPE_TEXT[shape];
  const Icon = SHAPE_ICON[shape];
  const device = deviceStatus({ paired: status.paired, online, signalingProblem: status.signalingProblem, peers, otherTab: status.otherTab === true });
  const linked = peers.filter((p) => p.state === 'connected').length;
  const title =
    shape === 'off'
      ? status.paired
        ? 'Sync is on, and no other device is paired yet'
        : 'Sync is off'
      : shape === 'direct'
        ? `Synced directly · ${linked} of ${peers.length}`
        : shape === 'relay'
          ? `Synced through the relay · ${linked} of ${peers.length}`
          : online
            ? 'Not connected to any device'
            : 'No network';
  const hint = shape === 'off' && status.paired ? 'Add a device in Settings to start syncing.' : device.hint;
  const other = [...health, ...(pendingNotices > 0 ? [{ level: 'info' as const, text: `${pendingNotices} merge${pendingNotices === 1 ? '' : 's'} worth a look.` }] : [])];
  const go = (href: string): void => {
    setOpen(false);
    location.hash = href;
  };
  const link = (href: string, label: string, primary = false) => (
    <a href={href} class={primary ? 'btn primary' : undefined} onClick={(e) => { e.preventDefault(); go(href); }}>
      {label}
    </a>
  );

  return (
    <>
      {online || shape === 'offline' ? null : (
        <Pill tone="outline" class="offline-chip" role="status" title="No network: everything still works and is saved on this device">
          Offline
        </Pill>
      )}
      <button
        type="button"
        ref={anchor}
        class={cx('btn', 'sync-btn', shape)}
        aria-label={`${text.label}: ${text.detail}`}
        title={`${text.label}: ${text.detail}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <span class="sync-shape"><Icon /></span>
        <span class="sync-label">{text.label}</span>
        <span class="sync-chevron"><IconChevronDown /></span>
      </button>
      <Popover id={id} open={open} anchor={anchor} onClose={() => setOpen(false)} label="Sync status" align="end" class="status-panel">
        <p class={cx('sync-head', shape)}>
          <span class="sync-shape"><Icon /></span>
          <strong>{title}</strong>
        </p>
        <p class="hint sync-hint">{hint}</p>
        {peers.length > 0 && (
          <ul class="sync-devices">
            {peers.map((p) => {
              const kind = linkKind(p);
              return (
                <li key={p.id}>
                  <span class="sync-device-name">{deviceName(account, p.id) ?? shortId(p.id)}</span>
                  <span class={cx('sync-kind', kind)}>{LINK_KIND_LABEL[kind]}</span>
                  {p.state !== 'connected' && <span class="hint">{lastConnected(p)}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {status.paired && <p class="hint sync-relay-note">The relay only carries sealed data, and is slower than a direct link.</p>}
        {other.length > 0 && (
          <>
            <h3 class="status-other">Other</h3>
            <ul class="status-list">
              {other.map((item, i) => (
                <li key={i} class={item.level}>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div class="status-links">
          {shape === 'off' ? link('#/settings/devices/add', status.paired ? 'Add a device' : 'Set up sync', true) : link('#/settings/devices', 'Devices')}
          {link('#/settings/backup', 'Backups')}
          {errors && link('#/help/report', 'Report a problem')}
        </div>
      </Popover>
    </>
  );
}
