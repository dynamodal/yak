import { useEffect, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { deviceFingerprint, type DeviceKeyRecord } from '../core/account-keys';
import { formatFingerprint } from '../core/keys';
import { switchDevices, type SwitchDevice } from '../core/key-switch';
import { ownerKeys } from '../app/account-keys-runtime';
import { useKeyTrust } from '../app/key-hooks';
import { Button } from '../app/ui';
import { withKey } from '../app/key-prompt';
import { devicesMap, readDevices, setDeviceName, suggestedName } from '../core/devices';
import { useYVersion } from '../app/hooks';

/**
 * Device keys, in Settings › Advanced (#257, F-33b): in compatible mode, the review of every device and the one-way
 * "Require device keys" switch; once keys are required, approving devices. One-time invites are on the Add a device page (`AddDevicePanel`).
 * Owner actions need the passphrase, kept unlocked for a few minutes.
 */

const shortId = (id: string): string => id.slice(0, 8);

/** The fingerprint of a device's keys, as its own Advanced section shows it: compare the two screens. */
export function Fingerprint(props: { keys: DeviceKeyRecord | undefined }) {
  const [fp, setFp] = useState('');
  useEffect(() => {
    let live = true;
    if (props.keys) void deviceFingerprint(props.keys).then((f) => live && setFp(formatFingerprint(f, 2)));
    return () => {
      live = false;
    };
  }, [props.keys?.sign.x]);
  return fp ? <code class="fingerprint">{fp}</code> : null;
}

/** This device's name, asked for when it makes a one-time code: the new device and the device lists show it instead of an id. */
export function OwnName(props: { account: Y.Doc; deviceId: string }) {
  useYVersion(devicesMap(props.account) as unknown as Y.AbstractType<unknown>);
  const [draft, setDraft] = useState<string | undefined>();
  const saved = readDevices(props.account).get(props.deviceId)?.name;
  return (
    <div class="row">
      <label>
        Name of this device{' '}
        <input
          aria-label="Name of this device"
          placeholder={suggestedName(navigator.userAgent)}
          value={draft ?? saved ?? ''}
          size={24}
          maxLength={40}
          autocomplete="off"
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onChange={(e) => {
            setDeviceName(props.account, props.deviceId, (e.target as HTMLInputElement).value);
            setDraft(undefined);
          }}
        />
      </label>
      <span class="hint">Your new device shows this name for it. Left empty, the suggestion is saved.</span>
    </div>
  );
}

function stragglerText(d: SwitchDevice): string {
  return d.state === 'old-build'
    ? 'Runs an older Yak: it stops syncing at the switch until you update it and it joins again.'
    : 'No keys yet: it stops syncing at the switch until you update Yak on it (for an Obsidian vault, the Yak plugin) and it joins again.';
}

export function DeviceKeysPanel(props: { account: Y.Doc; deviceId: string; seen: string[]; keysVersion: number }) {
  const { account, deviceId } = props;
  const trust = useKeyTrust();
  const [, setTick] = useState(0);
  const rerender = (): void => setTick((t) => t + 1);
  // The unlock lasts a few minutes: look again now and then so the page asks again when it ran out.
  useEffect(() => {
    const t = setInterval(rerender, 30_000);
    return () => clearInterval(t);
  }, []);
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set([deviceId]));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const act = (job: () => Promise<unknown>): void => {
    setError('');
    setBusy(true);
    void job()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy(false);
        rerender();
      });
  };
  const devices = switchDevices(account, [deviceId, ...props.seen]);
  const errorLine = error ? (
    <p class="error" role="alert">
      {error}
    </p>
  ) : null;

  if (!trust.required()) {
    const ready = devices.filter((d) => d.state === 'ready');
    // Not blocked, not deleted: these stop syncing until they join again with a one-time code (#311).
    const joinAgain = devices.filter((d) => d.state !== 'ready' || !approved.has(d.id));
    const name = (d: SwitchDevice): string => d.name ?? shortId(d.id);
    return (
      <section class="device-keys" aria-label="Device keys">
        <h3>Switch to device keys</h3>
        <p class="hint">
          This account still lets any device that holds its old code join. Switch it to device keys: from then on a device joins only with a one-time code that one of yours approves with your passphrase.
          Compare each device's fingerprint with the one in Advanced on that device, and tick only devices you recognise.
        </p>
        <ul class="key-review">
          {devices.map((d) => (
            <li key={d.id} data-device={d.id} data-state={d.state}>
              {d.state === 'ready' ? (
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Approve ${d.name ?? shortId(d.id)}`}
                    checked={approved.has(d.id)}
                    disabled={d.id === deviceId}
                    onChange={(e) => {
                      const next = new Set(approved);
                      if ((e.target as HTMLInputElement).checked) next.add(d.id);
                      else next.delete(d.id);
                      setApproved(next);
                    }}
                  />{' '}
                  {d.name ?? 'Unnamed device'}
                </label>
              ) : (
                <span>{d.name ?? 'Unnamed device'}</span>
              )}{' '}
              <code class="hint">{shortId(d.id)}</code> {d.id === deviceId ? <span class="hint">(this device)</span> : null} <Fingerprint keys={d.keys} />
              {d.state !== 'ready' ? <span class="hint straggler"> {stragglerText(d)}</span> : null}
            </li>
          ))}
        </ul>
        <ul class="hint switch-effects" data-switch-effects>
          <li>
            <strong>This cannot be undone.</strong> If Yak is ever rolled back to an earlier release, this account's devices stop syncing until Yak is updated again. No data is lost.
          </li>
          {joinAgain.length > 0 ? (
            <li data-join-again>
              Stop syncing until they join again with a one-time code: {joinAgain.map(name).join(', ')}. Nothing on them is deleted, and what they changed meanwhile merges back once you approve them.
            </li>
          ) : (
            <li>Every device listed will keep syncing.</li>
          )}
        </ul>
        {ready.length === 0 ? null : (
          <div class="row">
            <Button variant="primary" disabled={busy} onClick={() => act(() => withKey({ verb: 'switch to device keys', run: () => ownerKeys.current.requireKeys([...approved]) }))}>
              {`Switch to device keys for ${approved.size === 1 ? 'this device' : `these ${approved.size} devices`}`}
            </Button>
          </div>
        )}
        {errorLine}
      </section>
    );
  }

  const waiting = devices.filter((d) => d.state === 'ready' && !trust.certs.has(d.id));
  return (
    <section class="device-keys" aria-label="Device keys">
      <h3>Device keys</h3>
      <p class="hint" data-keys="required">
        This account requires device keys: a device syncs only once one of your devices approved it.
      </p>
      {waiting.length > 0 && (
        <>
          <p class="hint">Not approved yet. Compare the fingerprint with the one in Advanced on that device.</p>
          <ul class="key-review">
            {waiting.map((d) => (
              <li key={d.id} data-device={d.id}>
                {d.name ?? 'Unnamed device'} <code class="hint">{shortId(d.id)}</code> <Fingerprint keys={d.keys} />{' '}
                <Button disabled={busy} aria-label={`Approve ${d.name ?? shortId(d.id)}`} onClick={() => act(() => withKey({ verb: `approve ${d.name ?? shortId(d.id)}`, run: () => ownerKeys.current.approve(d.id).then(() => undefined) }))}>
                  Approve
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {errorLine}
    </section>
  );
}
