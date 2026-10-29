import { useState } from 'preact/hooks';
import { useSyncStatus } from '../app/hooks';
import { useApp } from '../app/context';
import { useKeyTrust } from '../app/key-hooks';
import { shares } from '../app/shares-runtime';
import { Dialog, Field, Sheet, SHEET_MEDIA, useMedia } from '../app/ui';
import { SharePanel } from '../app/views/SharePanel';

/** Spaces this account can share with a new account: its own, not archived, and (when `without` is given) not already shared with that account. */
export function shareableSpaces(allSpaces: { id: string; name: string; archived: boolean }[], without?: string): { id: string; name: string }[] {
  return allSpaces.filter((s) => {
    if (s.archived) return false;
    const view = shares.view(s.id);
    if (view && !view.owner) return false;
    return !(without && view?.state?.members.has(without));
  });
}

/**
 * The share sheet (#334): the existing share flow (SharePanel) for one space, opened with the link form showing.
 * From a space's page the space is given; from Settings or an account's page a list offers the spaces that can be
 * shared. With `expectAccount` (an account's page) the panel says plainly if a different account asks. The
 * passphrase sheet opens on top when making the link needs the account key (F-324).
 */
export function ShareSheet(props: { space?: string; /** Offer only spaces not yet shared with this account (fingerprint). */ without?: string; onClose(): void }) {
  const narrow = useMedia(SHEET_MEDIA);
  const { sync, allSpaces } = useApp();
  const trust = useKeyTrust();
  const status = useSyncStatus(sync);
  const options = props.space ? allSpaces.filter((s) => s.id === props.space) : shareableSpaces(allSpaces, props.without);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const space = options.find((s) => s.id === (chosen ?? props.space)) ?? options[0];
  // Only an older account that syncs several devices and has not finished its upgrade cannot share yet.
  const upgrade = status.paired && !trust.required();
  const body = upgrade ? (
    <p class="hint" role="status" data-share-upgrade>
      Your devices need one more step before sharing: <a href="#/settings/advanced" onClick={props.onClose}>finish it in Advanced › Device keys</a>.
    </p>
  ) : !space ? (
    <p class="hint" role="status">
      {props.without ? 'Every space you own is already shared with this account.' : 'You have no space to share yet.'}
    </p>
  ) : (
    <>
      {options.length > 1 ? (
        <Field layout="split" class="st-field" label="Space to share">
          <select aria-label="Space to share" value={space.id} onChange={(e) => setChosen((e.target as HTMLSelectElement).value)}>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <SharePanel key={space.id} space={space.id} name={space.name} startOpen {...(props.without ? { expectAccount: props.without } : {})} />
    </>
  );
  const label = space ? `Share ${space.name}` : 'Share a space';
  return narrow ? (
    <Sheet label={label} class="st-share-sheet" onClose={props.onClose}>
      {body}
    </Sheet>
  ) : (
    <Dialog label={label} class="st-share-sheet" onClose={props.onClose}>
      {body}
    </Dialog>
  );
}
