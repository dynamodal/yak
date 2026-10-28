import { useEffect, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { useOnline, useSyncStatus, useYVersion } from '../app/hooks';
import { leaveAccount, rejoinAccount } from '../app/leave';
import { hasBackup, resetDevice, resetDocIds, saveSafetyBackup } from '../app/reset';
import { safeStorage } from '../app/join';
import { Button, Page, PageHeader } from '../app/ui';
import type { ViewProps } from '../app/registry';
import { withKey } from '../app/key-prompt';
import { StatusDot } from '../app/views/StatusDot';
import { UndecidedNotice } from '../app/views/UndecidedNotice';
import { AccountKeyHint, KeyState } from './KeyState';
import { keysMap } from '../core/account-keys';
import { devicesMap, readDevices, setDeviceName, setRemoved, suggestedName } from '../core/devices';
import { keeps } from '../core/keeps';
import { relayNotice } from '../sync/relay-status';
import { DEFAULT_STUN_URLS, loadIceUrls, parseIceUrls, saveIceUrls } from '../sync/ice-servers';
import { deviceStatus, peerStatus } from '../sync/device-status';
import { defaultSignalingUrl, NTFY_SIGNALING_URL } from '../sync/transport-factory';
import { PairingExtras } from './extras';
import { RelayStatsLine } from './RelayStatsLine';
import { LogsPanel } from './LogsPanel';
import { LogSharingSwitch } from './LogSharingSwitch';
import { NoticesPanel } from './NoticesPanel';
import { DeviceKeysPanel } from './DeviceKeysPanel';
import { ownerKeys } from '../app/account-keys-runtime';
import { dropOwnDeviceKeys } from '../sync/key-store';
import { JoinStatus } from '../app/JoinStatus';
import { invites } from '../app/invites';
import { useKeyTrust } from '../app/key-hooks';

type Confirming = { kind: 'remove'; id: string } | { kind: 'rejoin' } | { kind: 'leave' } | undefined;

const shortId = (id: string): string => id.slice(0, 8);

/**
 * Devices and sync. Words used throughout (docs/sync.md): the account is your devices; the
 * one-time code adds a device to it; each device keeps some spaces. Every action says whom it reaches.
 */
export function DevicesView({ params }: ViewProps) {
  const { sync, deviceId, account: accountDoc, accountId, store, spaces } = useApp();
  const status = useSyncStatus(sync);
  const online = useOnline();
  useYVersion(devicesMap(accountDoc) as unknown as Y.AbstractType<unknown>);
  const keysVersion = useYVersion(keysMap(accountDoc) as unknown as Y.AbstractType<unknown>);
  // Keys required (#257): devices join by one-time invite, so the account's own code is no longer shown.
  const trust = useKeyTrust();
  const required = trust.required();
  const devices = readDevices(accountDoc);
  const nameOf = (id: string): string | undefined => devices.get(id)?.name;
  const labelOf = (id: string): string => nameOf(id) ?? shortId(id);
  // With keys required only a signed removal counts (#258); otherwise the shared flag.
  const isOut = (id: string): boolean => trust.blocked(id, devices.get(id)?.removed === true);
  const removed = [...devices.entries()].filter(([id]) => isOut(id) && id !== deviceId);
  // With keys required: a signed removal of this device's keys and no new approval (#258); otherwise the flag.
  const thisRemoved = required ? trust.removedDevices.has(deviceId) && !trust.certs.has(deviceId) : devices.get(deviceId)?.removed === true;
  const peers = status.peers.filter((p) => !isOut(p.id) && !devices.get(p.id)?.left);
  /** Another device is on record for this account: without one, a quiet device list is just a new setup, not a missed change. */
  const knownOthers = [...devices.entries()].some(([id, d]) => id !== deviceId && !d.left);
  const [removeError, setRemoveError] = useState('');

  const [joinSecret, setJoinSecret] = useState('');
  const [signaling, setSignaling] = useState(status.signalingUrl || defaultSignalingUrl());
  const [iceText, setIceText] = useState(loadIceUrls().join('\n'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const [confirming, setConfirming] = useState<Confirming>();
  const [erase, setErase] = useState<ReadonlySet<string>>(new Set());
  const [resetScope, setResetScope] = useState<string>('');
  const [resetHistory, setResetHistory] = useState(false);
  const [safetyFile, setSafetyFile] = useState('');
  const [, setCheckTick] = useState(0);
  /** The name being typed: a re-render from a document change (keys arrive at start) must not reset it before it is saved. */
  const [nameDraft, setNameDraft] = useState<string | undefined>();

  // `#/settings/devices/<id>` scrolls to that device and `#/settings/devices/add` to adding one (the table's header "+").
  const target = params[0];
  useEffect(() => {
    const el = target ? document.getElementById(target === 'add' ? 'add-device-section' : `device-${target}`) : null;
    el?.scrollIntoView?.({ block: 'start' });
  }, [target]);

  const joinNow = (): void => void run(() => invites.joinWithCode(joinSecret, signaling));
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

  // While in an account, the code to add a device is the one in use; a new code is only made on purpose.
  const device = deviceStatus({ paired: status.paired, online, signalingProblem: status.signalingProblem, peers: status.peers, otherTab: status.otherTab === true });
  // Reset this device's data: offered only while there is something to start again from.
  const otherDevices = peers.length > 0;
  const canReset = status.paired && otherDevices ? true : hasBackup();
  const resetAll = resetScope === 'all';
  const resetSpaces = resetAll ? spaces.map((s) => s.id) : resetScope ? [resetScope] : [];
  const resetIds = resetDocIds(resetSpaces, resetAll ? accountId : undefined).filter((id) => store.opened().has(id));
  const onlyHere = sync.onlyHere(resetIds);
  const keptElsewhere = (spaceId: string): boolean => peers.some((p) => keeps(accountDoc, p.id, spaceId));
  const nothingToRefillFrom = resetScope !== '' && !hasBackup() && !(resetAll ? otherDevices : resetSpaces.every(keptElsewhere));

  return (
    <Page width="settings" class="devices-page">
      <PageHeader title="Devices" />
      <p class="help-link"><a href="#/settings">← Settings</a> · <a href="#/help/devices">How this works</a></p>

      <p class="status-line" role="status">
        <StatusDot state={device.dot} />
        <span>
          <strong>{device.label}.</strong> {device.hint}
        </span>
      </p>
      {status.signalingPausedUntil !== undefined && status.signalingPausedUntil > Date.now() && (
        <p class="hint">
          The connection server is limiting requests from this network, so this device is waiting until{' '}
          {new Date(status.signalingPausedUntil).toLocaleTimeString()} before trying again. Devices on the same home network
          share that limit; this site's own server (the default) limits only very heavy use.
        </p>
      )}
      {relayNotice({ relayLimit: status.relayLimit, diagnosis: status.relayDiagnosis }) && (
        <p class="hint" role="status">
          {relayNotice({ relayLimit: status.relayLimit, diagnosis: status.relayDiagnosis })}
        </p>
      )}
      <NoticesPanel />
      {thisRemoved &&
        (required ? (
          <p class="error" data-removed-self>
            Another of your devices removed this one from the account, so it stopped syncing. It keeps what it already had. To come back, make a one-time code
            on one of your devices and enter it below.
          </p>
        ) : (
          <p class="error">
            Another of your devices removed this one, so your other devices ignore it. Choose "Allow again" for this device on one
            of them, or remove this device from the account below.
          </p>
        ))}
      <UndecidedNotice />

      <h2>This device</h2>
      <div class="device-row this-device" id="device-this">
        <div class="device-main">
          <label>
            Name{' '}
            <input
              aria-label="This device's name"
              placeholder={suggestedName(navigator.userAgent)}
              value={nameDraft ?? nameOf(deviceId) ?? ''}
              size={24}
              maxLength={40}
              onInput={(e) => setNameDraft((e.target as HTMLInputElement).value)}
              onChange={(e) => {
                setDeviceName(accountDoc, deviceId, (e.target as HTMLInputElement).value);
                setNameDraft(undefined);
              }}
            />
          </label>
          <span class="hint">Your other devices show this name.</span>
          <AccountKeyHint account={accountDoc} />
        </div>
      </div>

      <h2>Other devices in this account</h2>
      {peers.length === 0 && (
        <p class="hint">
          {!status.paired
            ? 'This device is not in an account of synced devices yet.'
            : !knownOthers
              ? 'No other device yet. Add one with + Add a device on the Settings page; it shows up here when it joins.'
              : required
                ? 'No other device is reachable now. If your other devices are on and still sync with each other, this device was removed or missed a change: join again with a one-time code, under "Join again or remove this device" below.'
                : 'No other devices yet. If your other devices switched to device keys and this one stopped hearing from them, join again with a one-time code, under "Join again or remove this device" below.'}
        </p>
      )}
      <ul class="device-list">
        {peers.map((p) => {
          const st = peerStatus(p.state, p.via);
          const name = labelOf(p.id);
          return (
            <li key={p.id} class="device-row" id={`device-${p.id}`}>
              <div class="device-main">
                <input
                  class="peer-name"
                  aria-label={`Name of ${name}`}
                  placeholder="Name this device"
                  value={nameOf(p.id) ?? ''}
                  size={20}
                  maxLength={40}
                  onChange={(e) => setDeviceName(accountDoc, p.id, (e.target as HTMLInputElement).value)}
                />{' '}
                {!nameOf(p.id) && <code class="hint">{shortId(p.id)}</code>}
                <span class="device-state">
                  <StatusDot state={st.dot} /> {st.label}
                </span>
                {p.sharedKey && <span class="hint">Syncs with the shared key: the key for just these two devices failed (until reload)</span>}
                {p.state !== 'connected' && p.lastConnectedAt && <span class="hint">Last linked {new Date(p.lastConnectedAt).toLocaleString()}</span>}
              </div>
              {p.state === 'waiting-for-peer' && (
                <p class="hint device-wait">
                  Waiting for it to open Yak. Phones pause Yak in the background: open it there to sync.{' '}
                  <Button aria-label={`Check again for ${name}`} title="Ask your other devices to answer now, for example right after you woke one" onClick={() => sync.reconnect()}>
                    Check again
                  </Button>
                </p>
              )}
              {confirming?.kind === 'remove' && confirming.id === p.id ? (
                required ? (
                  <div class="confirm-panel">
                    <p>
                      {name} stops getting anything new: your other devices no longer accept it. It keeps the data it already synced; nothing can take that
                      back. To use it again later, choose "Join again" on it and approve it with a new one-time code.
                    </p>
                    <div class="row">
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            setRemoveError('');
                            void run(async () => {
                              try {
                                if (await withKey({ verb: `remove ${name}`, run: () => ownerKeys.current.removeDevice(p.id) })) setConfirming(undefined);
                              } catch (e) {
                                setRemoveError(e instanceof Error ? e.message : String(e));
                              }
                            });
                          }}
                        >
                          Remove {name} from the account
                        </Button>
                        <Button onClick={() => setConfirming(undefined)}>Cancel</Button>
                      </div>
                    {removeError && (
                      <p class="error" role="alert">
                        {removeError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div class="confirm-panel">
                    <p>
                      All devices in this account stop syncing with {name}. Its copy of your data stays on it. It still holds your data, so if it was lost or stolen, remove it here first.
                    </p>
                    <div class="row">
                      <Button
                        variant="danger"
                        onClick={() => {
                          // Disconnecting follows from the shared list (main.tsx), on every device.
                          setRemoved(accountDoc, p.id, true);
                          setConfirming(undefined);
                        }}
                      >
                        Remove {name} from the account
                      </Button>
                      <Button onClick={() => setConfirming(undefined)}>Cancel</Button>
                    </div>
                  </div>
                )
              ) : (
                <div class="row">
                  <Button
                    variant="danger"
                    aria-label={`Remove ${name} from account…`}
                    title="Stop syncing with this device on all your devices"
                    onClick={() => setConfirming({ kind: 'remove', id: p.id })}
                  >
                    Remove from account…
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
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
                  <Button aria-label={`Allow ${d.name ?? shortId(id)} again`} onClick={() => setRemoved(accountDoc, id, false)}>
                    Allow again
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p class="hint keeps-note">
        Which spaces each device keeps is ticked in <a href="#/settings">Your data on Settings</a>.{' '}
        {required
          ? 'Unticking a space stops that device receiving it from now on; what it already has stays on it. Only approved devices get anything.'
          : 'Keeping is a choice, not a lock, until the account requires device keys: any device it already trusts can get any space.'}
      </p>

      {status.paired && required && <DeviceKeysPanel account={accountDoc} deviceId={deviceId} seen={peers.map((p) => p.id)} keysVersion={Number(keysVersion)} />}

      <div id="add-device-section" />
      {!required && <h2>Add a device to this account</h2>}
      {required ? null : status.paired ? (
        <p class="hint">
          To add a device, switch this account to device keys first (above). A new device joins with a one-time code that one of your devices approves.
        </p>
      ) : (
        <p class="hint">
          Start syncing on one device. On each other device, enter a one-time code made on a device that already syncs, and approve it there.
        </p>
      )}
      {!status.paired && (
        <div class="row">
          <Button
            variant="primary"
            disabled={busy}
            // The sheet makes the passphrase and approves this device (device keys); pairing then starts.
            onClick={() => run(async () => void (await withKey({ verb: 'start syncing', run: async () => void (await sync.startNewPairing(signaling)) })))}
          >
            Start syncing my devices
          </Button>
        </div>
      )}
      {!status.paired && (
        <div class="row">
          <input
            aria-label="One-time code"
            placeholder="One-time code from your other device"
            value={joinSecret}
            size={36}
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            autocomplete="off"
            onInput={(e) => setJoinSecret((e.target as HTMLInputElement).value)}
          />
          <Button variant="primary" disabled={busy || !joinSecret.trim()} onClick={joinNow}>
            Join
          </Button>
        </div>
      )}
      <PairingExtras
        secret={undefined}
        signaling={status.paired ? status.signalingUrl : signaling}
        scan={!status.paired}
        onSecret={setJoinSecret}
        onSignaling={setSignaling}
        onJoin={joinNow}
        busy={busy || !joinSecret.trim()}
      />
      <JoinStatus />
      {error ? <p class="error">{error}</p> : null}
      {status.paired && <p class="hint">To join a different account, remove this device from this one first.</p>}

      {status.paired && (
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
                  <strong>This works only once your account has switched to device keys on another device. If it has not, switch it there first (Devices → Switch to device keys); until then this device cannot join again. </strong>
                )}
                This device stops syncing and makes new device keys; its data stays and stays in this account. Then make a one-time code on
                another of your devices (Devices → Add a device), enter it here, and approve this device there with your passphrase.
              </p>
              <div class="row">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await rejoinAccount({ sync, dropKeys: () => dropOwnDeviceKeys() });
                      setConfirming(undefined);
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
              <p>
                This device stops syncing and leaves the account. Your other devices keep syncing with each other. This device's data stays on
                it, unless you choose to erase a space's copy here:
              </p>
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
                      await leaveAccount({ sync, account: accountDoc, me: deviceId, erase: [...erase], storage: safeStorage(), ...(required ? { dropKeys: () => dropOwnDeviceKeys() } : {}) });
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
      )}

      <details class="advanced">
        <summary>Advanced</summary>
        <h3>Ids and keys</h3>
        <p class="hint">
          This device: id <code>{shortId(deviceId)}</code> <KeyState account={accountDoc} deviceId={deviceId} version={Number(keysVersion)} />
        </p>
        <ul class="hint device-ids">
          {peers.map((p) => (
            <li key={p.id}>
              {labelOf(p.id)}: id <code>{shortId(p.id)}</code> <KeyState account={accountDoc} deviceId={p.id} version={Number(keysVersion)} />
            </li>
          ))}
        </ul>
        {status.paired && !required && <DeviceKeysPanel account={accountDoc} deviceId={deviceId} seen={peers.map((p) => p.id)} keysVersion={Number(keysVersion)} />}
        {canReset && (
          <details class="danger-zone" aria-label="Reset this device's data">
            <summary>Reset this device's data</summary>
            <p class="hint">
              Throw this device's copy away and start again from your other devices or a backup, for example when its copy has drifted or is bad. Other
              devices are not touched.
            </p>
            <div class="row">
              <label>
                What to reset{' '}
                <select
                  aria-label="What to reset"
                  value={resetScope}
                  onChange={(e) => {
                    setResetScope((e.target as HTMLSelectElement).value);
                    setSafetyFile('');
                  }}
                >
                  <option value="">Choose…</option>
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} only
                    </option>
                  ))}
                  <option value="all">Everything on this device</option>
                </select>
              </label>
            </div>
            {resetScope !== '' && (
              <div class="confirm-panel">
                <p>
                  {resetAll
                    ? 'Every space here is erased and this device leaves the account. Join again with a one-time code to get your data back from a linked device.'
                    : 'The space is erased here and fills again from a linked device that keeps it. This device stays in the account and keeps the space.'}
                </p>
                <p role="status">
                  {status.peers.some((p) => p.state === 'connected') ? (
                    onlyHere.unknown.length > 0 && onlyHere.count === 0 ? (
                      <>Cannot tell yet which changes exist only on this device. Check again in a moment.</>
                    ) : onlyHere.count === 0 ? (
                      <>
                        <strong>Nothing exists only on this device</strong>: a linked device has all of it.
                      </>
                    ) : (
                      <>
                        <strong>About {onlyHere.count} change{onlyHere.count === 1 ? '' : 's'} exist only on this device</strong> and are lost by a reset unless
                        they reach a linked device first. Keep Yak open and check again, or rely on the safety backup.
                      </>
                    )
                  ) : (
                    <>No other device is linked right now, so this device cannot tell which changes exist only here. Use the safety backup.</>
                  )}
                </p>
                <div class="row">
                  <Button onClick={() => setCheckTick((n) => n + 1)}>Check again</Button>
                </div>
                {nothingToRefillFrom && (
                  <p class="error">No other device keeps {resetAll ? 'these spaces' : 'this space'} and there is no backup, so a reset would lose it for good.</p>
                )}
                <div class="row">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        setSafetyFile(await saveSafetyBackup(store.opened(), deviceId));
                      })
                    }
                  >
                    Save a safety backup first
                  </Button>
                  {safetyFile && <span class="hint">Saved {safetyFile}. Restore it on the Backups page.</span>}
                </div>
                <label>
                  <input type="checkbox" checked={resetHistory} onChange={(e) => setResetHistory((e.target as HTMLInputElement).checked)} /> Also clear this
                  device's history log for {resetAll ? 'everything' : 'this space'}
                </label>
                <p class="hint">The history log lists earlier versions on this device only. Keep it unless the drift is in the log too.</p>
                <div class="row">
                  <Button
                    variant="danger"
                    disabled={busy || !safetyFile || nothingToRefillFrom}
                    onClick={() =>
                      resetDevice({
                        sync,
                        storage: safeStorage(),
                        spaces: resetSpaces,
                        ...(resetAll ? { accountId } : {}),
                        clearHistory: resetHistory,
                      })
                    }
                  >
                    Reset and reload
                  </Button>
                  <Button onClick={() => setResetScope('')}>Cancel</Button>
                </div>
              </div>
            )}
          </details>
        )}
        <h3>Connection</h3>
        <RelayStatsLine paired={status.paired} />
        {!status.paired && (
          <details>
            <summary>Connection server</summary>
            <p class="hint">
              Carries only encrypted handshakes; your data goes directly between devices. All devices with the same code must use the same
              server.
            </p>
            <input aria-label="Connection server" value={signaling} size={36} onInput={(e) => setSignaling((e.target as HTMLInputElement).value)} />
            <div class="row">
              <Button onClick={() => setSignaling(defaultSignalingUrl())} title="This site's own WebSocket relay">
                This site's relay (default)
              </Button>
              <Button onClick={() => setSignaling(NTFY_SIGNALING_URL)} title="Public ntfy.sh; devices on one network share its request limit">
                ntfy.sh
              </Button>
            </div>
          </details>
        )}

        <details>
          <summary>STUN servers</summary>
          <p class="hint">
            Let devices on different networks find each other's public address. They only see that address; no data passes through them. One per
            line, tried in order; applies to the next connection on this device.
          </p>
          <textarea
            aria-label="STUN servers"
            rows={3}
            cols={36}
            value={iceText}
            onInput={(e) => {
              const text = (e.target as HTMLTextAreaElement).value;
              setIceText(text);
              saveIceUrls(parseIceUrls(text));
            }}
          />
          <div class="row">
            <Button
              onClick={() => {
                saveIceUrls([]);
                setIceText(DEFAULT_STUN_URLS.join('\n'));
              }}
            >
              Use the defaults
            </Button>
          </div>
        </details>

        <details>
          <summary>Logs from all devices</summary>
          <LogSharingSwitch />
          <LogsPanel label={labelOf} />
        </details>

        <details onToggle={() => setLog(sync.report())}>
          <summary>Connection log</summary>
          <div class="row">
            <Button onClick={() => setLog(sync.report())}>Refresh</Button>
            <Button onClick={() => void navigator.clipboard?.writeText(sync.report())}>Copy report</Button>
          </div>
          <pre class="log">{log}</pre>
        </details>
      </details>
    </Page>
  );
}
