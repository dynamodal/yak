import type * as Y from 'yjs';
import { useState } from 'preact/hooks';
import { accountName } from '../app/accounts';
import { keyTrust } from '../app/account-keys-runtime';
import { useApp } from '../app/context';
import { lastSeen, useDeviceColumns } from '../app/device-columns';
import { isFeatureHidden } from '../app/features';
import { useYVersion } from '../app/hooks';
import { safeStorage } from '../app/join';
import { scheduleErase } from '../app/leave';
import { navigate } from '../app/router';
import { linkSettled, shareLinks } from '../app/share-links';
import { shares } from '../app/shares-runtime';
import { useShares } from '../app/use-shares';
import { Button, Field } from '../app/ui';
import { SharePanel } from '../app/views/SharePanel';
import { UndecidedNotice } from '../app/views/UndecidedNotice';
import { createSpace, removeSpace, renameSpace, setArchived, spacesMap, type AccountSpace } from '../core/account';
import { keeps, keepsMap } from '../core/keeps';
import { EDIT_WARNING } from './SharingSection';
import { KeepChip, OpenRow, useOpenRow } from './OpenRow';

/** What a closed space row says about its shares: the accounts it is shared with, or who shared it with you. */
function shareText(account: Y.Doc, space: string): string[] {
  const view = shares.view(space);
  if (!view?.active || !view.state) return [];
  const own = keyTrust.accountFp;
  if (view.owner) return [...view.state.members.values()].filter((m) => m.fp !== own).map((m) => accountName(account, m.fp, m.name));
  const owner = view.state.members.get(view.state.owner);
  return [`from ${accountName(account, view.state.owner, owner?.name)}`];
}

/** Live notes and time entries of a space, as far as this device holds them (undefined: not kept here). */
function countsOf(spaceDoc: Y.Doc | undefined, privateDoc: Y.Doc | undefined): { notes: number; entries: number } | undefined {
  if (!spaceDoc || !privateDoc) return undefined;
  const live = (m: Y.Map<unknown>): number => [...m.values()].filter((v) => !(v as Y.Map<unknown>).get('deleted')).length;
  return { notes: live(spaceDoc.getMap('notes')), entries: live(privateDoc.getMap('time_entries')) };
}

/** An open space row: the devices that keep it as toggle chips, who it is shared with, and rename, archive, remove (or leave a share). */
function SpaceBody(props: { space: AccountSpace }) {
  const s = props.space;
  const { account, spaceDocs, privateDocs, sync } = useApp();
  const { columns, localOnly } = useDeviceColumns();
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const [erase, setErase] = useState(false);
  const share = shares.view(s.id);
  const member = !!share && share.active && !share.owner;
  const counts = countsOf(spaceDocs.get(s.id), privateDocs.get(s.id));

  const confirmRemove = async (): Promise<void> => {
    const problem = removeSpace(account, s.id);
    setError(problem ?? '');
    setRemoving(false);
    if (problem) return;
    if (!erase) {
      navigate('settings', 'spaces');
      return;
    }
    scheduleErase(safeStorage(), [s.id]);
    if (sync.status.peers.some((p) => p.state === 'connected')) await new Promise((r) => setTimeout(r, 1500));
    location.hash = '#/settings/spaces';
    location.reload();
  };

  return (
    <>
      <fieldset class="st-keeps-set">
        <legend>Kept on</legend>
        <div class="st-chips">
          {columns.map((c) => (
            <span key={c.id} class="st-kept-device" data-kept-device={c.here ? 'this' : c.id}>
              <KeepChip deviceId={c.id} spaceId={s.id} who={c.who} spaceName={s.name} label={c.label} />
              {c.here ? null : <span class="hint st-kept-seen">{lastSeen(c.peer)}</span>}
            </span>
          ))}
        </div>
        <p class="hint">
          {localOnly ? `${s.name} lives on this device. Add a device to keep it on another one too.` : `Unticking stops a device receiving ${s.name} from now on; what it already has stays on it.`}
        </p>
      </fieldset>

      <h3>Shared with</h3>
      <p class="hint">Time entries and rates are never shared. {EDIT_WARNING}</p>
      <SharePanel space={s.id} name={s.name} hideTitle />

      {isFeatureHidden('notes') ? null : (
        <p class="hint">
          Attached files and the ones no note refers to are listed in <a href="#/settings/notes">Settings › Notes</a>.
        </p>
      )}

      <h3>Space</h3>
      <Field layout="split" class="st-field" label="Space name">
        <input
          type="text"
          aria-label={`Name of space ${s.name}`}
          defaultValue={s.storedName}
          key={s.storedName}
          maxLength={60}
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const problem = renameSpace(account, s.id, input.value);
            setError(problem ?? '');
            if (problem) input.value = s.storedName;
          }}
        />
      </Field>
      {error ? <p class="error">{error}</p> : null}
      {s.archived && <p class="hint">Archived: hidden from pickers and lists, still synced and kept.</p>}
      <div class="row">
        <Button onClick={() => setError(setArchived(account, s.id, !s.archived) ?? '')}>{s.archived ? `Unarchive ${s.name}` : `Archive ${s.name}`}</Button>
        {member ? null : <Button variant="danger" onClick={() => setRemoving(!removing)}>{`Remove ${s.name}`}</Button>}
      </div>
      {removing && !member && (
        <div class="confirm-panel" role="group" aria-label={`Remove ${s.name}`}>
          <p>
            <strong>Remove {s.name} from the account?</strong> Every device stops keeping it and it disappears from the lists. The data stays in backups and history.
          </p>
          <p role="status">
            {counts
              ? `${s.name} holds ${counts.notes} note${counts.notes === 1 ? '' : 's'} and ${counts.entries} time ${counts.entries === 1 ? 'entry' : 'entries'} on this device. They are left without a space.`
              : `This device does not keep ${s.name}, so it cannot count its notes and entries. Anything in it is left without a space.`}
          </p>
          <label>
            <input type="checkbox" checked={erase} onChange={(e) => setErase((e.target as HTMLInputElement).checked)} /> Also erase this device's copy (other devices keep theirs)
          </label>
          <div class="row">
            <Button variant="danger" onClick={() => void confirmRemove()}>
              Remove {s.name} from the account
            </Button>
            <Button onClick={() => setRemoving(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Spaces (F-33): one row per space ("Work · on 2 devices", with who it is shared with). A row opens in place with the devices that keep it,
 * who it is shared with, Rename, Archive and Remove. New space is a form under the rows.
 */
export function SpacesSection(props: { target?: string }) {
  const { account, allSpaces, deviceId } = useApp();
  const { columns } = useDeviceColumns();
  useShares();
  useYVersion(keepsMap(account) as unknown as Y.AbstractType<unknown>);
  useYVersion(spacesMap(account) as unknown as Y.AbstractType<unknown>);
  useYVersion(account.getMap('settings') as unknown as Y.AbstractType<unknown>);
  const [open, setOpen] = useOpenRow(props.target);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState('');

  return (
    <>
      <p class="hint">A space keeps its notes, tasks and time entries together. Each device keeps the spaces you choose.</p>
      <ul class="st-rows" aria-label="Spaces">
        {allSpaces.map((s) => {
          const on = columns.filter((c) => keeps(account, c.id, s.id)).length;
          const chips = shareText(account, s.id);
          const linkOpen = shareLinks.hosting?.space === s.id && !linkSettled(shareLinks.hosting);
          // Someone who used the link and waits for an answer: say so here, not only inside the row.
          const asking = shareLinks.hosting?.space === s.id ? shareLinks.hosting.requests.filter((r) => r.state === 'waiting') : [];
          return (
            <OpenRow
              key={s.id}
              id={`space-${s.id}`}
              open={open === s.id}
              onToggle={(o) => setOpen(o ? s.id : undefined)}
              attrs={{ 'data-space': s.id }}
              title={
                <>
                  {s.name}
                  {s.archived ? <span class="hint"> (archived)</span> : null}
                </>
              }
              sub={`on ${on} ${on === 1 ? 'device' : 'devices'}`}
              aside={
                <span class="st-chips">
                  {chips.map((n, i) => (
                    <span key={i} class="st-chip" data-chip>
                      {n}
                    </span>
                  ))}
                  {asking.map((r) => (
                    <span key={r.ask.deviceId} class="st-chip st-chip-ask" data-chip data-share-request>
                      {r.ask.name ?? 'Another account'} asks to join
                    </span>
                  ))}
                  {linkOpen && asking.length === 0 ? (
                    <span class="st-chip" data-chip>
                      link open
                    </span>
                  ) : null}
                </span>
              }
            >
              <SpaceBody space={s} />
            </OpenRow>
          );
        })}
      </ul>
      {allSpaces.length === 0 ? <UndecidedNotice /> : null}
      <div class="row st-actions">
        {adding ? (
          <>
            <input type="text" aria-label="New space name" placeholder="Name of the new space" value={newName} maxLength={60} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />
            <Button
              variant="primary"
              onClick={() => {
                const result = createSpace(account, newName, deviceId);
                if ('error' in result) setNewError(result.error);
                else {
                  setNewError('');
                  setNewName('');
                  setAdding(false);
                }
              }}
            >
              Create space
            </Button>
            <Button
              onClick={() => {
                setAdding(false);
                setNewError('');
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button onClick={() => setAdding(true)}>+ New space</Button>
        )}
      </div>
      {newError ? <p class="error">{newError}</p> : null}
    </>
  );
}
