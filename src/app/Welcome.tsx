import { useEffect, useState } from 'preact/hooks';
import { addSpace, randomId } from '../core/account';
import { Scanner } from '../qr';
import type { PairingPayload } from '../qr';
import { defaultSignalingUrl } from '../sync/transport-factory';
import { APP_NAME } from '../constants';
import { useApp } from './context';
import { useSyncStatus } from './hooks';
import { PRESETS, setHiddenModules, type FeatureId } from './features';
import { navigate, useRoute } from './router';
import { JoinCodeInput } from './JoinCodeInput';
import { pendingShare } from './pending-share';
import { safeStorage } from './join';
import { Button } from './ui';
import { suggestedName } from '../core/devices';
import { joinWithCode } from './join-state';
import { JoinStatus } from './JoinStatus';

const grouped = (secret: string): string => secret.match(/.{1,4}/g)?.join('-') ?? secret;

/**
 * First start on a device: no space exists until a choice is made. Starting fresh makes the account
 * with one space; the small "Already use Yak?" line opens joining (takes the account's spaces) and restoring.
 */
export function Welcome(props: { onStarted(): void }) {
  const { sync, account, deviceId } = useApp();
  const status = useSyncStatus(sync);
  const [code, setCode] = useState('');
  const [signaling, setSignaling] = useState(status.signalingUrl || defaultSignalingUrl());
  const [name, setName] = useState('Personal');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState(() => suggestedName(navigator.userAgent));
  // A join link opened here (`#/join/<code>`, option A+): the code is filled in and the joining part is open.
  const route = useRoute();
  const link = route[0] === 'join' && route[1] ? route : undefined;
  useEffect(() => {
    if (!link) return;
    try {
      setCode(grouped(link[1] ?? ''));
      if (link[2]) setSignaling(link[2]);
    } catch {
      // not a code: the field stays empty
    }
  }, [link?.join('/')]);

  const join = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      await joinWithCode(code, signaling, deviceLabel);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const scanned = (p: PairingPayload): void => {
    setCode(grouped(p.secret));
    if (p.signalingUrl) setSignaling(p.signalingUrl);
  };
  const start = (hidden: FeatureId[]): void => {
    const problem = addSpace(account, randomId(), name, undefined, deviceId);
    if (problem) setError(problem);
    else {
      // The choice is this device's own (F-309). A device that joins later starts with everything on; Settings › Features changes it.
      setHiddenModules(hidden);
      props.onStarted();
      // A share link was opened first: carry on with it.
      const link = pendingShare(safeStorage());
      if (link) navigate('share', link);
    }
  };

  return (
    <section class="welcome page-settings">
      <h1>Welcome to {APP_NAME}</h1>
      <ul class="welcome-about">
        <li>Track your time, and keep notes and tasks in Markdown.</li>
        <li>Everything stays in this browser. No sign-up, no server.</li>
        <li>Clearing this site's data in your browser deletes Yak's data. Set up a backup in Settings to be safe.</li>
        <li>Optional: sync between your own devices later.</li>
      </ul>

      {pendingShare(safeStorage()) ? (
        <p class="hint" role="status" data-pending-share>
          You opened a share link. Start here first; joining carries on afterwards.
        </p>
      ) : null}
      <div class="card welcome-choice">
        <h2>Start on this device</h2>
        <p class="hint">Your data lives in a space. Start with one; more can be added later in Settings.</p>
        <div class="row">
          <label>
            Name of the first space{' '}
            <input aria-label="Name of the first space" value={name} size={20} maxLength={40} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <div class="row">
          <Button variant="primary" disabled={!name.trim()} onClick={() => start(PRESETS.timeTracker)}>
            Time tracker
          </Button>
          <Button disabled={!name.trim()} onClick={() => start(PRESETS.everything)}>
            Time, notes and tasks
          </Button>
        </div>
        <p class="hint">Time tracker hides Notes and Tasks; the other choice shows Time, Notes and Tasks. You can change this any time in Settings › Features.</p>
      </div>

      <details class="welcome-more" open={link ? true : undefined}>
        <summary>Already use {APP_NAME}? Join a device or restore a backup</summary>
        <div class="card welcome-choice">
          <h2>Join my other device</h2>
          <p class="hint">On the other device open Settings, choose + Add a device, then Make a one-time code, and scan it here, open its link here, or paste the link or type the code. That device approves this one. This device gets that account's spaces.</p>
          <div class="row">
            <JoinCodeInput value={code} onCode={setCode} onSignaling={setSignaling} onEnter={() => void join()} />
            <Button variant="primary" disabled={busy || !code.trim()} onClick={() => void join()}>
              Join
            </Button>
          </div>
          <div class="row">
            <label>
              Name of this device{' '}
              <input aria-label="Name of this device" value={deviceLabel} size={24} maxLength={40} autocomplete="off" onInput={(e) => setDeviceLabel((e.target as HTMLInputElement).value)} />
            </label>
          </div>
          <JoinStatus />
          <Scanner onResult={scanned} onJoin={() => void join()} busy={busy || !code.trim()} />
          <details>
            <summary>Connection server</summary>
            <input aria-label="Connection server" value={signaling} size={36} onInput={(e) => setSignaling((e.target as HTMLInputElement).value)} />
          </details>
        </div>

        <div class="card welcome-choice">
          <h2>Restore from a backup</h2>
          <p class="hint">Open a backup folder or file made earlier.</p>
          <Button onClick={() => navigate('backup')}>Restore from a backup…</Button>
        </div>
      </details>
      {error ? <p class="error">{error}</p> : null}
    </section>
  );
}
