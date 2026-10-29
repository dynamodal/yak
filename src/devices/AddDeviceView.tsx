import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { useOnline, useSyncStatus } from '../app/hooks';
import { JoinCodeInput } from '../app/JoinCodeInput';
import { JoinStatus } from '../app/JoinStatus';
import { invites } from '../app/invites';
import { useKeyTrust } from '../app/key-hooks';
import { withKey } from '../app/key-prompt';
import type { ViewProps } from '../app/registry';
import { Button, Page, PageHeader } from '../app/ui';
import { SyncDot } from '../app/views/SyncDot';
import { overallShape } from '../app/sync-state';
import { UndecidedNotice } from '../app/views/UndecidedNotice';
import { groupSecret } from '../qr/payload';
import { deviceStatus } from '../sync/device-status';
import { defaultSignalingUrl, NTFY_SIGNALING_URL } from '../sync/transport-factory';
import { AddDevicePanel } from './AddDevicePanel';
import { PairingExtras } from './extras';

/**
 * Add a device, `#/settings/devices/add` (F-33): the one flow that keeps a page of its own. An account that requires device keys
 * makes a one-time code (QR and link first, the code to type as the fallback); a device that does not sync yet starts syncing or
 * joins with a code, a link or a scan. A join request shows above the code. `#/settings/devices/add/<code>` is a join link
 * (`#/join/<code>`): the code is filled in.
 */
export function AddDeviceView({ params }: ViewProps) {
  const { sync, deviceId, account } = useApp();
  const status = useSyncStatus(sync);
  const online = useOnline();
  const trust = useKeyTrust();
  const required = trust.required();
  const [signaling, setSignaling] = useState(status.signalingUrl || defaultSignalingUrl());
  const [joinSecret, setJoinSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A join link brings the code (and the server) in the address: take it once, then leave the address clean.
  const taken = useRef(false);
  useEffect(() => {
    if (taken.current || params[0] !== 'add' || !params[1]) return;
    taken.current = true;
    try {
      setJoinSecret(groupSecret(params[1]));
      if (params[2]) setSignaling(params[2]);
    } catch {
      // not a code: the field stays empty
    }
    history.replaceState(null, '', '#/settings/devices/add');
  }, [params.join('/')]);

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
  const joinNow = (): void => void run(() => invites.joinWithCode(joinSecret, signaling));
  const device = deviceStatus({ paired: status.paired, online, signalingProblem: status.signalingProblem, peers: status.peers, otherTab: status.otherTab === true });

  return (
    <Page width="settings" class="devices-page st">
      <PageHeader title="Add a device" />
      <p class="help-link">
        <a href="#/settings/devices-sync">← Settings</a> · <a href="#/help/devices">How this works</a>
      </p>
      <p class="status-line" role="status">
        <SyncDot shape={overallShape({ paired: status.paired, online, peers: status.peers })} />
        <span>
          <strong>{device.label}.</strong> {device.hint}
        </span>
      </p>

      <UndecidedNotice />
      {status.paired && required ? <AddDevicePanel account={account} deviceId={deviceId} /> : null}
      {status.paired && !required ? (
        <p class="hint">
          To add a device, switch this account to device keys first, under <a href="#/settings/advanced">Advanced › Device keys</a>. A new device then joins with a one-time code that one of your devices approves.
        </p>
      ) : null}
      {!status.paired ? (
        <>
          <p class="hint">Start syncing on one device. On each other device, enter a one-time code, a link or a QR code made on a device that already syncs, and approve it there.</p>
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
          <div class="row">
            <JoinCodeInput value={joinSecret} onCode={setJoinSecret} onSignaling={setSignaling} onEnter={joinNow} />
            <Button variant="primary" disabled={busy || !joinSecret.trim()} onClick={joinNow}>
              Join
            </Button>
          </div>
          <PairingExtras secret={undefined} signaling={signaling} scan onSecret={setJoinSecret} onSignaling={setSignaling} onJoin={joinNow} busy={busy || !joinSecret.trim()} />
          <details>
            <summary>Connection server</summary>
            <p class="hint">Carries only encrypted handshakes; your data goes directly between devices. All devices with the same code must use the same server.</p>
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
        </>
      ) : null}
      <JoinStatus />
      {error ? <p class="error">{error}</p> : null}
      {status.paired ? <p class="hint">To join a different account, remove this device from this one first (Settings › Devices and sync).</p> : null}
    </Page>
  );
}
