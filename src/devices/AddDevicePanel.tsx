import { useEffect, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { withKey } from '../app/key-prompt';
import { copyText } from '../app/clipboard';
import { invites } from '../app/invites';
import { Button, toast } from '../app/ui';
import { groupSecret, joinLink, QrCode } from '../qr';
import { OwnName } from './DeviceKeysPanel';

const shortId = (id: string): string => id.slice(0, 8);

/** Re-render when invites change; returns them. */
function useInvites(): typeof invites {
  const [, setTick] = useState(0);
  useEffect(() => invites.subscribe(() => setTick((t) => t + 1)), []);
  return invites;
}

/** The share sheet of the phone or computer, where the browser has one (feature-detected; never required). */
const canShare = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * Add a device to an account that requires device keys (#257), one-time code option A+ (#22): the QR code and a link come first,
 * the code in groups of four is the fallback to type. A join request shows above them, with the code to compare.
 * Nothing about the code or the pairing changes: the link and the QR code carry the same code, which works once and for 15 minutes.
 */
export function AddDevicePanel(props: { account: Y.Doc; deviceId: string }) {
  const { account, deviceId } = props;
  const inv = useInvites();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const act = (job: () => Promise<unknown>): void => {
    setError('');
    setBusy(true);
    void job()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const hosting = inv.hosting;
  // Every asker has been answered and the code is used: the code and QR are no longer needed.
  const settled = !!hosting && hosting.used && hosting.requests.length > 0 && hosting.requests.every((r) => r.state === 'approved' || r.state === 'declined');
  const link = hosting ? joinLink(location.origin + location.pathname, hosting.code, hosting.signalingUrl) : '';
  const copy = (what: string, text: string): void => void copyText(text).then((done) => toast(done ? `${what} copied.` : `Could not copy: select it and copy by hand.`));
  const send = (): void =>
    void navigator.share({ title: 'Add this device to Yak', text: 'Open this link on the new device. It works once and for 15 minutes.', url: link }).catch(() => undefined);

  return (
    <section class="add-device" aria-label="Add a device">
      <OwnName account={account} deviceId={deviceId} />
      {!hosting ? (
        <>
          <p class="hint">Make a one-time code, then scan its QR code on the new device or send it the link. It works once and for 15 minutes; you approve the device here after comparing a code both screens show.</p>
          <div class="row">
            <Button variant="primary" disabled={busy} onClick={() => act(() => inv.open())}>
              Make a one-time code
            </Button>
          </div>
        </>
      ) : (
        <div class="invite" data-collapsed={settled ? '' : undefined}>
          <ul class="invite-requests">
            {hosting.requests.map((r) => (
              <li key={r.request.deviceId} data-device={r.request.deviceId} data-state={r.state}>
                <p>
                  <strong>{r.request.name ?? 'A new device'}</strong> <code class="hint">{shortId(r.request.deviceId)}</code> asks to join. Approve only if the new device shows the same code and says the codes match:{' '}
                  <code class="compare-code" data-compare>
                    {r.compare}
                  </code>
                </p>
                {r.state === 'waiting' || r.state === 'approving' ? (
                  <div class="row">
                    <Button variant="primary" disabled={busy || r.state === 'approving'} onClick={() => act(() => withKey({ verb: `approve ${r.request.name ?? 'the new device'}`, run: () => inv.approve(r.request.deviceId) }))}>
                      Approve
                    </Button>
                    <Button onClick={() => act(() => inv.decline(r.request.deviceId))}>Decline</Button>
                  </div>
                ) : (
                  <p class="hint">{r.state === 'approved' ? 'Approved: it joins in a moment.' : 'Declined.'}</p>
                )}
                {r.error ? <p class="error">{r.error}</p> : null}
              </li>
            ))}
          </ul>
          {settled ? null : (
            <>
              <div class="qr-pair" data-invite-qr>
                <QrCode secret={hosting.code} signalingUrl={hosting.signalingUrl} />
                <div class="qr-side">
                  <p class="hint qr-note">
                    On the new device, scan this, or open the link below. The QR code and the link carry the one-time code itself: show them only to the device you are adding.
                  </p>
                  <div class="row">
                    {canShare() ? (
                      <Button variant="primary" onClick={send}>
                        Send link
                      </Button>
                    ) : null}
                    <Button onClick={() => copy('Link', link)}>Copy link</Button>
                  </div>
                </div>
              </div>
              <div class="secret-box">
                <p class="hint">Or type the one-time code, until {new Date(hosting.expiresAt).toLocaleTimeString()}</p>
                <div class="row">
                  <code class="secret" data-invite-code>
                    {groupSecret(hosting.code)}
                  </code>
                  <Button onClick={() => copy('Code', groupSecret(hosting.code))}>
                    Copy code
                  </Button>
                </div>
              </div>
            </>
          )}
          {hosting.requests.length === 0 ? <p class="hint">On the new device: open Yak → Join my other device, and scan the QR code, open the link, or paste the link or code.</p> : null}
          {hosting.used && !settled ? (
            <p class="hint" role="status" data-invite-used>
              This code is used up: it admits one device. Make a new one to add another.
            </p>
          ) : null}
          {hosting.oldBuilds.length > 0 ? (
            <p class="error" role="status">
              A device tried this code with an older Yak ({hosting.oldBuilds.map(shortId).join(', ')}). Reload Yak on it to update, then enter the code again.
            </p>
          ) : null}
          <div class="row">
            {hosting.used ? (
              <Button disabled={busy} onClick={() => act(() => inv.open())}>
                Make a new one-time code
              </Button>
            ) : null}
            <Button onClick={() => inv.close()}>{settled ? 'Done' : 'Close the code'}</Button>
          </div>
        </div>
      )}
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
