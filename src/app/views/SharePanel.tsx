import { useEffect, useState } from 'preact/hooks';
import { sharedSince } from '../../core/account-labels';
import { formatFingerprint } from '../../core/keys';
import { TextQrCode } from '../../qr';
import { keyTrust } from '../account-keys-runtime';
import { accountName } from '../accounts';
import { useApp } from '../context';
import { withKey } from '../key-prompt';
import { linkSettled, shareLinks, shareLinkUrl } from '../share-links';
import { shares } from '../shares-runtime';
import { Button, toast } from '../ui';
import { copyText } from '../clipboard';
import { useShares } from '../use-shares';

const short = (fp: string): string => formatFingerprint(fp, 2);

/** "12 min left" for a link that expires at `at`. */
function timeLeft(at: number): string {
  const min = Math.ceil((at - Date.now()) / 60_000);
  return min <= 0 ? 'expiring now' : `${min} min left`;
}

/**
 * Sharing one space with another account (#259, #334): the Shared with section of a space's page and the share sheet (Settings, an account's page); the passphrase sheet
 * opens when an action needs it. The owner makes a one-time link and approves the asking account after
 * comparing a code; the owner ends a member with the passphrase; a member leaves without one. A single note is shared by moving it into its own space.
 */
export function SharePanel(props: {
  space: string;
  name: string;
  /** Open with the "make a link" form showing (the share sheet on Settings). */
  startOpen?: boolean;
  /** The space's page already has a heading. */
  hideTitle?: boolean;
  /** Sharing another space from an account's page: the fingerprint of the account the link is meant for. A different account asking is said plainly, not refused. */
  expectAccount?: string;
}) {
  const { account } = useApp();
  useShares();
  const [, setTick] = useState(0);
  const rerender = (): void => setTick((t) => t + 1);
  useEffect(() => {
    const t = setInterval(rerender, 30_000);
    return () => clearInterval(t);
  }, []);
  const { space, name } = props;
  const view = shares.view(space);
  const hosting = shareLinks.hosting?.space === space ? shareLinks.hosting : undefined;
  const [yourName, setYourName] = useState(() => {
    try {
      return shareLinks.ownerName();
    } catch {
      return '';
    }
  });
  const [form, setForm] = useState<'link' | { end: string } | 'leave' | undefined>(() => {
    const v = shares.view(props.space);
    return props.startOpen && (!v || v.owner) && shareLinks.hosting?.space !== props.space ? 'link' : undefined;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // `job` may go through the passphrase sheet (`withKey`): false means it was closed without running.
  const act = (job: () => Promise<unknown>, done?: () => void): void => {
    setError('');
    setBusy(true);
    void job()
      .then((ran) => (ran === false ? undefined : done?.()))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy(false);
        rerender();
      });
  };
  // Every asker has been answered and the link is used: the link, QR code and codes are no longer needed.
  const settled = linkSettled(hosting);
  // Spent and every approved account is in the roster: nothing left to show of the link.
  const finished = settled && !!hosting && hosting.requests.every((r) => r.state === 'declined' || !!view?.state?.members.has(r.ask.account));
  const errorLine = error ? (
    <p class="error" role="alert">
      {error}
    </p>
  ) : null;

  const members = view ? [...view.state!.members.values()].filter((m) => m.fp !== view.state!.owner) : [];
  const owner = view ? view.state!.members.get(view.state!.owner) : undefined;
  const ownFp = keyTrust.accountFp;

  return (
    <section class="share-panel" aria-label={`Sharing ${name}`} data-share={view ? (view.owner ? 'owner' : view.active ? 'member' : 'ended') : 'none'}>
      {props.hideTitle ? null : <h2>{name}</h2>}
      {!view ? (
        <p class="hint">Not shared with any account. Only this space is shared; each of you keeps your own devices and everything else.</p>
      ) : !view.active ? (
        <>
          <p class="hint" role="status" data-share-ended>
            Not connected: this share was ended by its owner{owner?.name ? ` (${owner.name})` : ''}, or you are no longer in it. {name} stays here as your own space, with what it holds now.
          </p>
          <div class="row">
            <Button disabled={busy} onClick={() => act(() => shareLinks.leave(space))}>
              Forget this share
            </Button>
          </div>
        </>
      ) : (
        <>
          <p class="hint" data-share-summary>
            {view.owner ? `Shared by you with ${members.length} other ${members.length === 1 ? 'account' : 'accounts'}.` : `Shared by ${owner?.name ?? short(view.state!.owner)}.`}
          </p>
          <ul class="share-members">
            {[...view.state!.members.values()]
              .filter((m) => m.fp !== ownFp)
              .map((m) => {
                const label = accountName(account, m.fp, m.name);
                const since = sharedSince(account, space, m.fp);
                const n = view.connected.get(m.fp) ?? 0;
                return (
                  <li key={m.fp} data-member={m.fp}>
                    <div class="share-member-main">
                      <div>
                        <a href={`#/settings/account/${m.fp}`}>
                          <strong>{label}</strong>
                        </a>
                        {m.fp === view.state!.owner ? <span class="hint"> (owner)</span> : null} <code class="hint">{short(m.fp)}</code>
                      </div>
                      <div class="hint">
                        {since ? `Since ${new Date(since).toLocaleDateString()} · ` : ''}
                        {n > 0 ? `${n} device${n === 1 ? '' : 's'} connected` : 'not connected now'}
                      </div>
                    </div>
                    {view.owner && m.fp !== view.state!.owner ? (
                      <Button aria-label={`End share with ${label}`} onClick={() => setForm({ end: m.fp })}>
                        End…
                      </Button>
                    ) : null}
                  </li>
                );
              })}
          </ul>
          {typeof form === 'object' && view.owner ? (
            <div class="confirm-panel" role="group" aria-label="End the share">
              <p>
                <strong>End the share with {accountName(account, form.end, view.state!.members.get(form.end)?.name)}?</strong> Nothing more is exchanged with them. They keep what they have so far, and so do you. Deleting anything here never deletes it there from now on. They can be added again with a new link.
              </p>
              <div class="row">
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => act(() => withKey({ verb: `end the share with ${accountName(account, form.end, view.state!.members.get(form.end)?.name)}`, run: () => shares.end(space, form.end) }), () => setForm(undefined))}
                >
                  End share
                </Button>
                <Button onClick={() => setForm(undefined)}>Cancel</Button>
              </div>
            </div>
          ) : null}
          {!view.owner ? (
            form === 'leave' ? (
              <div class="confirm-panel" role="group" aria-label="Leave the share">
                <p>
                  <strong>Leave this share?</strong> {name} stays here as your own space, with what it holds now. Nothing more is exchanged; the others keep their copies too. The owner can add you again with a new link.
                </p>
                <div class="row">
                  <Button variant="danger" disabled={busy} onClick={() => act(() => shareLinks.leave(space), () => setForm(undefined))}>
                    Leave share
                  </Button>
                  <Button onClick={() => setForm(undefined)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div class="row">
                <Button onClick={() => setForm('leave')}>Leave…</Button>
              </div>
            )
          ) : null}
          {props.hideTitle ? null : <p class="hint">Deleting a note, task or file in a shared space deletes it for everyone in the share.</p>}
        </>
      )}
      {(!view || view.owner) && (!hosting || finished) ? (
        form === 'link' ? (
          <div class="share-form" role="group" aria-label="Share with another account">
            <p class="hint">
              You make a link that works once, for 15 minutes. The other account opens it in Yak, you both compare a code over a call, and you approve here. They see the name below. To share a single note, first move it into its own space.
            </p>
            <label>
              Your name, shown to them{' '}
              <input type="text" aria-label="Your name" placeholder="Your name or your account's name" value={yourName} maxLength={80} onInput={(e) => setYourName((e.target as HTMLInputElement).value)} />
            </label>
            <div class="row">
              <Button variant="primary" disabled={busy || !yourName.trim()} onClick={() => act(() => withKey({ verb: 'make a link', run: () => shareLinks.open(space, yourName) }), () => setForm(undefined))}>
                Make a link
              </Button>
              <Button onClick={() => setForm(undefined)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div class="row">
            <Button onClick={() => setForm('link')}>{`+ Share ${name} with an account`}</Button>
          </div>
        )
      ) : null}
      {hosting && !finished ? (
        <div class="invite" data-share-link data-collapsed={settled ? '' : undefined}>
          {settled ? null : (
            <>
              <p class="hint" data-share-time-left>
                One-time link for one account: {timeLeft(hosting.expiresAt)} (until {new Date(hosting.expiresAt).toLocaleTimeString()}). Send it to them; do not post it anywhere.
              </p>
              <code class="secret" data-share-url>
                {shareLinkUrl(hosting.code)}
              </code>
              <div class="row">
                <Button
                  onClick={() => {
                    void copyText(shareLinkUrl(hosting.code)).then((ok) => toast(ok ? 'Copied the link.' : 'The browser blocked copying. Select the link and copy it.'));
                  }}
                >
                  Copy link
                </Button>
              </div>
              <TextQrCode text={shareLinkUrl(hosting.code)} label="QR code carrying the share link" />
            </>
          )}
          <ul class="invite-requests">
            {hosting.requests.map((r) => (
              <li key={r.ask.deviceId} data-device={r.ask.deviceId} data-state={r.state}>
                <p>
                  <strong>{r.ask.name ?? 'Another account'}</strong> <code class="hint">{short(r.ask.account)}</code> asks to join {hosting.spaceName}. Approve only if they see the same code and say the codes match:{' '}
                  <code class="compare-code" data-compare>
                    {r.compare}
                  </code>
                </p>
                {props.expectAccount ? (
                  r.ask.account === props.expectAccount ? (
                    <p class="hint" data-account-match>
                      This is {accountName(account, props.expectAccount)} (same fingerprint).
                    </p>
                  ) : (
                    <p class="error" role="status" data-account-differs>
                      This is not {accountName(account, props.expectAccount)}: its fingerprint is {short(r.ask.account)}, not {short(props.expectAccount)}. Approve only if you meant to share with this account.
                    </p>
                  )
                ) : null}
                {r.state === 'waiting' || r.state === 'approving' ? (
                  <>
                    <div class="row">
                      <Button
                        variant="primary"
                        disabled={busy || r.state === 'approving'}
                        onClick={() => act(() => withKey({ verb: `approve ${r.ask.name ?? 'them'}`, run: () => shareLinks.approve(r.ask.deviceId) }))}
                      >
                        Approve
                      </Button>
                      <Button onClick={() => act(() => shareLinks.decline(r.ask.deviceId))}>Decline</Button>
                    </div>
                  </>
                ) : (
                  <p class="hint">{r.state === 'approved' ? 'Approved: they join in a moment.' : 'Declined.'}</p>
                )}
                {r.error ? <p class="error">{r.error}</p> : null}
              </li>
            ))}
          </ul>
          {hosting.used && !settled ? (
            <p class="hint" role="status" data-share-used>
              This link is used up: it admits one account. Make a new one to add another.
            </p>
          ) : null}
          <div class="row">
            <Button onClick={() => shareLinks.close()}>{settled ? 'Done' : 'Cancel link'}</Button>
          </div>
        </div>
      ) : null}
      {errorLine}
    </section>
  );
}
