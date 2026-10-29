import type * as Y from 'yjs';
import { useState } from 'preact/hooks';
import { keyTrust } from '../app/account-keys-runtime';
import { otherAccounts, type OtherAccount, type SharedSpace } from '../app/accounts';
import { useApp } from '../app/context';
import { useYVersion } from '../app/hooks';
import { withKey } from '../app/key-prompt';
import { shareLinks } from '../app/share-links';
import { shares } from '../app/shares-runtime';
import { useShares } from '../app/use-shares';
import { Button, Field } from '../app/ui';
import { setAccountLabel, sharedSince } from '../core/account-labels';
import { formatFingerprint } from '../core/keys';
import { OpenRow, useOpenRow } from './OpenRow';
import { ShareSheet, shareableSpaces } from './ShareSheet';

export const EDIT_WARNING = 'Other accounts can edit and delete in what you share, and data cannot be taken back.';

/** What a closed row says about the shares with one account. */
function summary(youShare: number, withYou: number): string {
  const parts: string[] = [];
  if (youShare) parts.push(`you share ${youShare} ${youShare === 1 ? 'space' : 'spaces'}`);
  if (withYou) parts.push(`shares ${withYou} with you`);
  return parts.join(' · ');
}

type Pending = { kind: 'end' | 'leave'; space: SharedSpace };

/**
 * An open account row (#334): its full fingerprint, your name for it (Rename), the spaces you share with it (End…), the spaces it
 * shares with you (Leave…) and "+ Share another space". Every share is still per space, with its own one-time link and code comparison.
 */
function AccountBody(props: { account: OtherAccount }) {
  const a = props.account;
  const fp = a.fp;
  const { account, allSpaces } = useApp();
  const [draft, setDraft] = useState<string | undefined>();
  const [sharing, setSharing] = useState(false);
  const [pending, setPending] = useState<Pending | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = (job: () => Promise<unknown>): void => {
    setError('');
    setBusy(true);
    void job()
      .then((ran) => (ran === false ? undefined : setPending(undefined)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const text = draft ?? a.label;
  const canShare = shareableSpaces(allSpaces, fp).length > 0;

  return (
    <>
      <p>
        Fingerprint <code data-account-fingerprint>{formatFingerprint(fp, 8)}</code>
      </p>
      <p class="hint">It identifies the account. Compare it with them if you want to be sure who this is.</p>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          setAccountLabel(account, fp, text === a.chosen ? '' : text);
          setDraft(undefined);
        }}
      >
        <Field layout="split" class="st-field" label="Your name for it">
          <input type="text" aria-label="Your name for this account" value={text} maxLength={80} placeholder={a.chosen ?? 'Another account'} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} />
        </Field>
        <Button type="submit">Rename</Button>
      </form>
      <p class="hint">{a.chosen ? `It chose the name "${a.chosen}". ` : 'It gave no name. '}Only your devices see this name.</p>
      <p class="hint st-warning" data-edit-warning>
        {EDIT_WARNING}
      </p>
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}

      <h3>You share with {a.label}</h3>
      {a.youShare.length === 0 ? <p class="hint">No space of yours is shared with {a.label}.</p> : null}
      <ul class="st-share-list">
        {a.youShare.map((sp) => {
          const since = sharedSince(account, sp.space, fp);
          return (
            <li key={sp.space} data-shared-space={sp.space}>
              <span class="share-member-main">
                <a href={`#/settings/spaces/${sp.space}`}>
                  <strong>{sp.name}</strong>
                </a>
                {since ? <span class="hint st-account-sub">Since {new Date(since).toLocaleDateString()}</span> : null}
              </span>
              <Button aria-label={`End ${sp.name} share with ${a.label}`} onClick={() => setPending({ kind: 'end', space: sp })}>
                End…
              </Button>
            </li>
          );
        })}
      </ul>
      {pending?.kind === 'end' ? (
        <div class="confirm-panel" role="group" aria-label="End the share">
          <p>
            <strong>End sharing {pending.space.name} with {a.label}?</strong> Nothing more is exchanged with them. They keep what they have so far, and so do you. Deleting anything here never deletes it there from now on. They can be added again with a new link.
          </p>
          <div class="row">
            <Button variant="danger" disabled={busy} onClick={() => run(() => withKey({ verb: `end the share with ${a.label}`, run: () => shares.end(pending.space.space, fp) }))}>
              End share
            </Button>
            <Button onClick={() => setPending(undefined)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      <div class="row">{canShare ? <Button onClick={() => setSharing(true)}>+ Share another space</Button> : <p class="hint">Every space you own is already shared with {a.label}.</p>}</div>

      {a.sharesWithYou.length > 0 ? (
        <>
          <h3>{a.label} shares with you</h3>
          <ul class="st-share-list">
            {a.sharesWithYou.map((sp) => {
              const since = sharedSince(account, sp.space, fp);
              return (
                <li key={sp.space} data-shares-with-you={sp.space}>
                  <span class="share-member-main">
                    <a href={`#/settings/spaces/${sp.space}`}>
                      <strong>{sp.name}</strong>
                    </a>
                    {since ? <span class="hint st-account-sub">Since {new Date(since).toLocaleDateString()}</span> : null}
                  </span>
                  <Button aria-label={`Leave ${sp.name}`} onClick={() => setPending({ kind: 'leave', space: sp })}>
                    Leave…
                  </Button>
                </li>
              );
            })}
          </ul>
          {pending?.kind === 'leave' ? (
            <div class="confirm-panel" role="group" aria-label="Leave the share">
              <p>
                <strong>Leave {pending.space.name}?</strong> {pending.space.name} stays here as your own space, with what it holds now. Nothing more is exchanged; the others keep their copies too. The owner can add you again with a new link.
              </p>
              <div class="row">
                <Button variant="danger" disabled={busy} onClick={() => run(() => shareLinks.leave(pending.space.space))}>
                  Leave
                </Button>
                <Button onClick={() => setPending(undefined)}>Cancel</Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {sharing ? <ShareSheet without={fp} onClose={() => setSharing(false)} /> : null}
    </>
  );
}

/**
 * Sharing (F-33, #334): every account this account shares a space with, or has one shared by, as rows that open in place, and
 * "+ Share a space" for a new link. The edit-and-delete warning is always shown.
 */
export function SharingSection(props: { target?: string }) {
  const { account, allSpaces } = useApp();
  useShares();
  useYVersion(account.getMap('settings') as unknown as Y.AbstractType<unknown>);
  const [open, setOpen] = useOpenRow(props.target);
  const [sharing, setSharing] = useState(false);
  const list = otherAccounts(account, keyTrust.accountFp, allSpaces, (id) => shares.view(id));
  return (
    <section class="st-accounts" aria-label="Other accounts">
      <p class="hint">{EDIT_WARNING}</p>
      {list.length === 0 ? (
        <p class="hint">Nothing is shared with another account.</p>
      ) : (
        <ul class="st-rows st-account-list" aria-label="Other accounts">
          {list.map((a) => (
            <OpenRow
              key={a.fp}
              id={`account-${a.fp}`}
              open={open === a.fp}
              onToggle={(o) => setOpen(o ? a.fp : undefined)}
              attrs={{ 'data-account': a.fp }}
              title={
                <>
                  <strong>{a.label}</strong> <code class="hint">{formatFingerprint(a.fp, 2)}</code>
                </>
              }
              sub={summary(a.youShare.length, a.sharesWithYou.length)}
            >
              <AccountBody account={a} />
            </OpenRow>
          ))}
        </ul>
      )}
      <div class="row st-actions">
        <Button onClick={() => setSharing(true)}>+ Share with an account</Button>
      </div>
      {sharing ? <ShareSheet onClose={() => setSharing(false)} /> : null}
    </section>
  );
}
