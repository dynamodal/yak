import { useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { ownerKeys } from '../app/account-keys-runtime';
import { useApp } from '../app/context';
import { lastSeen, useDeviceColumns } from '../app/device-columns';
import { useSyncStatus, useYVersion } from '../app/hooks';
import { safeStorage } from '../app/join';
import { useKeyTrust } from '../app/key-hooks';
import { withKey } from '../app/key-prompt';
import { leaveAccount, rejoinAccount } from '../app/leave';
import { navigate } from '../app/router';
import { settingsParts } from '../app/settings-parts';
import { Button, DataLine } from '../app/ui';
import { StatusDot } from '../app/views/StatusDot';
import { UndecidedNotice } from '../app/views/UndecidedNotice';
import { deviceName, devicesMap, readDevices, setDeviceName, setRemoved, suggestedName } from '../core/devices';
import { keeps } from '../core/keeps';
import { deviceStatus, peerStatus } from '../sync/device-status';
import { dropOwnDeviceKeys } from '../sync/key-store';
import { KeepChip, keptNames, OpenRow, useOpenRow } from './OpenRow';

const shortId = (id: string): string => id.slice(0, 8);

type Confirming = { kind: 'remove'; id: string } | { kind: 'rejoin' } | { kind: 'leave' } | undefined;

/** The Sync line: always there, whatever the state (F-33): "Off · Set up", "On · waiting for your first device", "Syncing with Laptop". */
export function SyncLine() {
  const { sync, account } = useApp();
  const status = useSyncStatus(sync);
  useYVersion(devicesMap(account) as unknown as Y.AbstractType<unknown>);
  if (!status.paired) {
    return (
      <DataLine id="sync" tone="off" label="Sync" text="Off">
        <a href="#/settings/devices/add">Set up</a>
      </DataLine>
    );
  }
  const names = status.peers.filter((p) => p.state === 'connected').map((p) => deviceName(account, p.id) ?? 'an unnamed device');
  const text = names.length > 0 ? `Syncing with ${names.join(', ')}` : status.peers.length === 0 ? 'On · waiting for your first device' : 'On · waiting for your other devices';
  return (
    <DataLine id="sync" tone={names.length > 0 ? 'ok' : 'off'} label="Sync" text={text}>
      <a href="#/settings/devices/add">Add a device</a>
    </DataLine>
  );
}

/** The dot for the contents row: how this device syncs. */
export function useSyncDot(): 'ok' | 'warn' | 'off' {
  const { sync } = useApp();
  const status = useSyncStatus(sync);
  if (!status.paired) return 'off';
  const d = deviceStatus({ paired: true, online: typeof navigator === 'undefined' || navigator.onLine !== false, signalingProblem: status.signalingProblem, peers: status.peers, otherTab: status.otherTab === true });
  return d.dot === 'connected' ? 'ok' : d.dot === 'reconnecting' || d.dot === 'stopped' ? 'warn' : 'off';
}

/**
 * Devices and sync (F-33): the Sync line, then one row per device. A row opens in place: the spaces the device keeps as toggle chips,
 * Rename, and Remove… (another device) or leaving the account (this one). Adding a device is a page of its own.
 */
export function DevicesSection(props: { target?: string }) {
  const { account, allSpaces, spaces, deviceId, sync } = useApp();
  const status = useSyncStatus(sync);
  const trust = useKeyTrust();
  const required = trust.required();
  const { columns } = useDeviceColumns();
  useYVersion(devicesMap(account) as unknown as Y.AbstractType<unknown>);
  const devices = readDevices(account);
  const isOut = (id: string): boolean => trust.blocked(id, devices.get(id)?.removed === true);
  const removed = [...devices.entries()].filter(([id]) => isOut(id) && id !== deviceId);
  const [open, setOpen] = useOpenRow(props.target === 'this' ? deviceId : props.target);
  const [confirming, setConfirming] = useState<Confirming>();
  const [erase, setErase] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nameDraft, setNameDraft] = useState<string | undefined>();
  const run = async (action: () => Promise<void>): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const parts = settingsParts('devices-sync');

  return (
    <>
      <div class="st-lines" aria-label="Sync status">
        <SyncLine />
      </div>
      {parts.map((p) => (
        <p.component key={p.id} />
      ))}
      <UndecidedNotice />
      <ul class="st-rows" aria-label="Devices">
        {columns.map((c) => {
          const named = deviceName(account, c.id);
          const title = named ?? (c.here ? 'This device' : 'Unnamed device');
          const peer = c.peer;
          const st = peer ? peerStatus(peer.state, peer.via) : undefined;
          const kept = keptNames(allSpaces, (s) => keeps(account, c.id, s));
          const sub = c.here ? `This device · keeps ${kept}` : `${lastSeen(peer)} · keeps ${kept}`;
          const rowOpen = open === c.id;
          return (
            <OpenRow
              key={c.id}
              id={`device-${c.id}`}
              open={rowOpen}
              onToggle={(o) => {
                setOpen(o ? c.id : undefined);
                setConfirming(undefined);
              }}
              attrs={{ 'data-device-row': c.here ? 'this' : c.id }}
              title={
                <>
                  {title}
                  {named ? null : <span class="hint"> · Rename</span>}
                </>
              }
              sub={sub}
              aside={st ? <StatusDot state={st.dot} /> : undefined}
            >
              <fieldset class="st-keeps-set">
                <legend>Keeps</legend>
                <div class="st-chips">
                  {allSpaces.map((s) => (
                    <KeepChip key={s.id} deviceId={c.id} spaceId={s.id} who={c.who} spaceName={s.name} label={s.name} />
                  ))}
                  {allSpaces.length === 0 ? <span class="hint">No spaces yet.</span> : null}
                </div>
                <p class="hint">Unticking stops this device receiving a space from now on; what it already has stays on it.</p>
              </fieldset>
              {c.here ? (
                <label class="st-name">
                  Name{' '}
                  <input
                    aria-label="This device's name"
                    placeholder={suggestedName(navigator.userAgent)}
                    value={nameDraft ?? named ?? ''}
                    size={24}
                    maxLength={40}
                    onInput={(e) => setNameDraft((e.target as HTMLInputElement).value)}
                    onChange={(e) => {
                      setDeviceName(account, deviceId, (e.target as HTMLInputElement).value);
                      setNameDraft(undefined);
                    }}
                  />
                  <span class="hint"> Your other devices show this name.</span>
                </label>
              ) : (
                <>
                  <label class="st-name">
                    Name{' '}
                    <input
                      class="peer-name"
                      aria-label={`Name of ${named ?? shortId(c.id)}`}
                      placeholder="Name this device"
                      value={named ?? ''}
                      size={20}
                      maxLength={40}
                      onChange={(e) => setDeviceName(account, c.id, (e.target as HTMLInputElement).value)}
                    />
                  </label>
                  {st ? (
                    <p class="device-state">
                      <StatusDot state={st.dot} /> {st.label}
                    </p>
                  ) : null}
                  {peer?.sharedKey ? <p class="hint">Syncs with the shared key: the key for just these two devices failed (until reload)</p> : null}
                  {peer && peer.state === 'waiting-for-peer' ? (
                    <p class="hint device-wait">
                      Waiting for it to open Yak. Phones pause Yak in the background: open it there to sync.{' '}
                      <Button aria-label={`Check again for ${named ?? shortId(c.id)}`} title="Ask your other devices to answer now, for example right after you woke one" onClick={() => sync.reconnect()}>
                        Check again
                      </Button>
                    </p>
                  ) : null}
                  {confirming?.kind === 'remove' && confirming.id === c.id ? (
                    <div class="confirm-panel">
                      <p>
                        {required
                          ? `${named ?? 'This device'} stops getting anything new: your other devices no longer accept it. It keeps the data it already synced; nothing can take that back. To use it again later, choose "Join again" on it and approve it with a new one-time code.`
                          : `All devices in this account stop syncing with ${named ?? 'this device'}. Its copy of your data stays on it. It still holds your data, so if it was lost or stolen, remove it here first.`}
                      </p>
                      <div class="row">
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              if (required) {
                                if (await withKey({ verb: `remove ${named ?? 'the device'}`, run: () => ownerKeys.current.removeDevice(c.id) })) setConfirming(undefined);
                              } else {
                                // Disconnecting follows from the shared list (main.tsx), on every device.
                                setRemoved(account, c.id, true);
                                setConfirming(undefined);
                              }
                            })
                          }
                        >
                          Remove {named ?? 'this device'} from the account
                        </Button>
                        <Button onClick={() => setConfirming(undefined)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div class="row">
                      <Button variant="danger" aria-label={`Remove ${named ?? shortId(c.id)} from account…`} title="Stop syncing with this device on all your devices" onClick={() => setConfirming({ kind: 'remove', id: c.id })}>
                        Remove from account…
                      </Button>
                    </div>
                  )}
                </>
              )}
              {c.here && status.paired ? (
                <details class="danger-zone">
                  <summary>Join again or remove this device</summary>
                  <div class="row">
                    <Button onClick={() => setConfirming({ kind: 'rejoin' })}>Join again with a one-time code…</Button>
                    <Button variant="danger" onClick={() => setConfirming({ kind: 'leave' })}>
                      Remove this device from the account…
                    </Button>
                  </div>
                  {confirming?.kind === 'rejoin' && (
                    <div class="confirm-panel">
                      <p>
                        {required ? null : (
                          <strong>This works only once your account has switched to device keys on another device. If it has not, switch it there first (Settings › Advanced › Device keys); until then this device cannot join again. </strong>
                        )}
                        This device stops syncing and makes new device keys; its data stays and stays in this account. Then make a one-time code on another of your devices (Settings › Devices and sync › Add a device), enter it here, and approve this device there with your passphrase.
                      </p>
                      <div class="row">
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await rejoinAccount({ sync, dropKeys: () => dropOwnDeviceKeys() });
                              setConfirming(undefined);
                              navigate('settings', 'devices', 'add');
                            })
                          }
                        >
                          Stop syncing and join again
                        </Button>
                        <Button onClick={() => setConfirming(undefined)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                  {confirming?.kind === 'leave' && (
                    <div class="confirm-panel">
                      <p>This device stops syncing and leaves the account. Your other devices keep syncing with each other. This device's data stays on it, unless you choose to erase a space's copy here:</p>
                      <ul class="erase-list">
                        {spaces.map((s) => (
                          <li key={s.id}>
                            <label>
                              <input
                                type="checkbox"
                                checked={erase.has(s.id)}
                                aria-label={`Also erase ${s.name} on this device`}
                                onChange={(e) => {
                                  const next = new Set(erase);
                                  if ((e.target as HTMLInputElement).checked) next.add(s.id);
                                  else next.delete(s.id);
                                  setErase(next);
                                }}
                              />{' '}
                              Also erase {s.name} on this device
                            </label>
                          </li>
                        ))}
                      </ul>
                      <p class="hint">Erasing deletes only this device's copy, and cannot be undone here. Other devices keep theirs.</p>
                      <div class="row">
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await leaveAccount({ sync, account, me: deviceId, erase: [...erase], storage: safeStorage(), ...(required ? { dropKeys: () => dropOwnDeviceKeys() } : {}) });
                              setErase(new Set());
                              setConfirming(undefined);
                            })
                          }
                        >
                          Remove this device
                        </Button>
                        <Button onClick={() => setConfirming(undefined)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </details>
              ) : null}
              {error && rowOpen ? (
                <p class="error" role="alert">
                  {error}
                </p>
              ) : null}
            </OpenRow>
          );
        })}
      </ul>
      {columns.length === 1 && !status.paired ? <p class="hint">Your spaces live on this device only. Add a device to keep them on another one too.</p> : null}
      {columns.length === 1 && status.paired ? <p class="hint">No other device yet. Add one; it shows up here when it joins.</p> : null}
      {removed.length > 0 && (
        <div class="removed-devices">
          <p class="hint">Removed devices</p>
          <ul>
            {removed.map(([id, d]) => (
              <li key={id}>
                {d.name ?? 'Unnamed device'} <code class="hint">{shortId(id)}</code>{' '}
                {required ? (
                  <span class="hint">To use it again, choose "Join again" on it and approve it with a new one-time code.</span>
                ) : (
                  <Button aria-label={`Allow ${d.name ?? shortId(id)} again`} onClick={() => setRemoved(account, id, false)}>
                    Allow again
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div class="row st-actions">
        <a class="btn" href="#/settings/devices/add">
          + Add a device
        </a>
      </div>
    </>
  );
}
