import { useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { useOnline, useSyncStatus, useYVersion } from '../app/hooks';
import { useKeyTrust } from '../app/key-hooks';
import { hasBackup, resetDevice, resetDocIds, saveSafetyBackup } from '../app/reset';
import { safeStorage } from '../app/join';
import { Button } from '../app/ui';
import { lazyComponent } from '../app/lazy';
import { keysMap } from '../core/account-keys';
import { devicesMap, readDevices } from '../core/devices';
import { keeps } from '../core/keeps';
import { relayNotice } from '../sync/relay-status';
import { DEFAULT_STUN_URLS, loadIceUrls, parseIceUrls, saveIceUrls } from '../sync/ice-servers';
import { deviceStatus } from '../sync/device-status';
import { StatusDot } from '../app/views/StatusDot';
import { DeviceKeysPanel } from './DeviceKeysPanel';
import { KeyState } from './KeyState';
import { LogSharingSwitch } from './LogSharingSwitch';
import { LogsPanel } from './LogsPanel';
import { NoticesPanel } from './NoticesPanel';
import { RelayStatsLine } from './RelayStatsLine';

const shortId = (id: string): string => id.slice(0, 8);

/** The devices this account syncs with now: not removed, not left. */
function useLinkedPeers() {
  const { sync, account, deviceId } = useApp();
  const status = useSyncStatus(sync);
  const trust = useKeyTrust();
  useYVersion(devicesMap(account) as unknown as Y.AbstractType<unknown>);
  const devices = readDevices(account);
  const isOut = (id: string): boolean => trust.blocked(id, devices.get(id)?.removed === true);
  const peers = status.peers.filter((p) => !isOut(p.id) && !devices.get(p.id)?.left);
  const label = (id: string): string => devices.get(id)?.name ?? shortId(id);
  return { status, peers, label, account, deviceId, trust };
}

/** Under the Sync line in Devices and sync: how this device is doing, a limited connection server, merges worth a look, and a removal (only when it is true). */
export function DeviceNotices() {
  const { account, deviceId } = useApp();
  const { status, trust } = useLinkedPeers();
  const online = useOnline();
  useYVersion(devicesMap(account) as unknown as Y.AbstractType<unknown>);
  const required = trust.required();
  const device = deviceStatus({ paired: status.paired, online, signalingProblem: status.signalingProblem, peers: status.peers, otherTab: status.otherTab === true });
  const thisRemoved = required ? trust.removedDevices.has(deviceId) && !trust.certs.has(deviceId) : readDevices(account).get(deviceId)?.removed === true;
  const relay = relayNotice({ relayLimit: status.relayLimit, refusal: status.relayRefusal, diagnosis: status.relayDiagnosis });
  return (
    <>
      <p class="status-line" role="status" data-device-status>
        <StatusDot state={device.dot} />
        <span>
          <strong>{device.label}.</strong> {device.hint}
        </span>
      </p>
      {status.signalingPausedUntil !== undefined && status.signalingPausedUntil > Date.now() && !status.relayRefusal && (
        <p class="hint">
          The connection server is limiting requests from this network, so this device is waiting until {new Date(status.signalingPausedUntil).toLocaleTimeString()} before trying again. Devices on the same home network share that limit, and many devices or many reconnects in a short time can reach it.
        </p>
      )}
      {relay && (
        <p class="hint" role="status">
          {relay}
        </p>
      )}
      <NoticesPanel />
      {thisRemoved &&
        (required ? (
          <p class="error" data-removed-self>
            This device was removed from your account by another of your devices, so it stopped syncing. It keeps what it already had. <a href="#/settings/devices/add">Join again</a> with a one-time code made on one of your devices.
          </p>
        ) : (
          <p class="error">
            Another of your devices removed this one, so your other devices ignore it. Choose "Allow again" for this device on one of them, or remove this device from the account in its row below.
          </p>
        ))}
    </>
  );
}

/** Advanced: this device's id and keys, the other devices' ids and keys, and the switch to device keys (F-33b, #21). */
export function IdsAndKeys() {
  const { status, peers, label, account, deviceId } = useLinkedPeers();
  const keysVersion = useYVersion(keysMap(account) as unknown as Y.AbstractType<unknown>);
  const required = useKeyTrust().required();
  return (
    <div class="st-adv" data-adv="keys">
      <h3>Device keys and ids</h3>
      <p class="hint">
        This device: id <code>{shortId(deviceId)}</code> <KeyState account={account} deviceId={deviceId} version={Number(keysVersion)} />
      </p>
      <ul class="hint device-ids">
        {peers.map((p) => (
          <li key={p.id}>
            {label(p.id)}: id <code>{shortId(p.id)}</code> <KeyState account={account} deviceId={p.id} version={Number(keysVersion)} />
          </li>
        ))}
      </ul>
      {status.paired || required ? <DeviceKeysPanel account={account} deviceId={deviceId} seen={peers.map((p) => p.id)} keysVersion={Number(keysVersion)} /> : <p class="hint">Device keys are set up when this device starts syncing.</p>}
    </div>
  );
}

/** Advanced: the connection (relay, server, STUN), the logs from all devices and the connection log. */
export function ConnectionPart() {
  const { sync } = useApp();
  const { status, label } = useLinkedPeers();
  const [iceText, setIceText] = useState(loadIceUrls().join('\n'));
  const [log, setLog] = useState('');
  return (
    <div class="st-adv" data-adv="connection">
      <h3>Connection</h3>
      <RelayStatsLine paired={status.paired} />
      <p class="hint">
        Connection server: <code>{status.signalingUrl}</code>.{' '}
        {status.paired ? 'It carries only encrypted handshakes; your data goes directly between devices.' : <>Change it on the <a href="#/settings/devices/add">Add a device</a> page before this device starts syncing.</>}
      </p>
      <details>
        <summary>STUN servers</summary>
        <p class="hint">
          Let devices on different networks find each other's public address. They only see that address; no data passes through them. One per line, tried in order; applies to the next connection on this device.
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
        <LogsPanel label={label} />
      </details>
      <details onToggle={() => setLog(sync.report())}>
        <summary>Connection log</summary>
        <div class="row">
          <Button onClick={() => setLog(sync.report())}>Refresh</Button>
          <Button onClick={() => void navigator.clipboard?.writeText(sync.report())}>Copy report</Button>
        </div>
        <pre class="log">{log}</pre>
      </details>
    </div>
  );
}

/** Advanced: re-sync this device (the old "reset"), offered only while there is something to start again from. */
export function ResetPart() {
  const { sync, store, spaces, accountId } = useApp();
  const { status, peers, account, deviceId } = useLinkedPeers();
  const [busy, setBusy] = useState(false);
  const [resetScope, setResetScope] = useState('');
  const [resetHistory, setResetHistory] = useState(false);
  const [safetyFile, setSafetyFile] = useState('');
  const [, setCheckTick] = useState(0);
  const otherDevices = peers.length > 0;
  const canReset = status.paired && otherDevices ? true : hasBackup();
  if (!canReset) return null;
  const resetAll = resetScope === 'all';
  const resetSpaces = resetAll ? spaces.map((s) => s.id) : resetScope ? [resetScope] : [];
  const resetIds = resetDocIds(resetSpaces, resetAll ? accountId : undefined).filter((id) => store.opened().has(id));
  const onlyHere = sync.onlyHere(resetIds);
  const keptElsewhere = (spaceId: string): boolean => peers.some((p) => keeps(account, p.id, spaceId));
  const nothingToRefillFrom = resetScope !== '' && !hasBackup() && !(resetAll ? otherDevices : resetSpaces.every(keptElsewhere));
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  return (
    <details class="danger-zone" aria-label="Re-sync this device" data-adv="reset">
      <summary>Re-sync this device (keeps settings and files)</summary>
      <p class="hint">Throw this device's copy of the documents away and start again from your other devices or a backup, for example when its copy has drifted or is bad. Other devices are not touched.</p>
      <p class="hint">
        Erases: the notes, time entries and other records of the space you choose (or of every space, with the account document and the sync code, when you choose everything), and optionally their history log.
        Keeps: this device's id, settings, files in notes, the backup folder choice, restore points and the offline copy of the app.
        To remove all of it, use "Erase everything on this device" below.
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
                  <strong>About {onlyHere.count} change{onlyHere.count === 1 ? '' : 's'} exist only on this device</strong> and are lost by a reset unless they reach a linked device first. Keep Yak open and check again, or rely on the safety backup.
                </>
              )
            ) : (
              <>No other device is linked right now, so this device cannot tell which changes exist only here. Use the safety backup.</>
            )}
          </p>
          <div class="row">
            <Button onClick={() => setCheckTick((n) => n + 1)}>Check again</Button>
          </div>
          {nothingToRefillFrom && <p class="error">No other device keeps {resetAll ? 'these spaces' : 'this space'} and there is no backup, so a reset would lose it for good.</p>}
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
            <input type="checkbox" checked={resetHistory} onChange={(e) => setResetHistory((e.target as HTMLInputElement).checked)} /> Also clear this device's history log for {resetAll ? 'everything' : 'this space'}
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
  );
}

/** Advanced: erase every store of Yak on this device. Loads when Advanced opens it (the main bundle is on a budget). */
export const EraseDevicePart = lazyComponent(() => import('./EraseDevice'));
