import { accountDocId, addSpace, CURRENT_ACCOUNT_KEY, freeSpaceName, readSpaces } from '../core/account';
import { keysMap, readAccountKeys } from '../core/account-keys';
import { decodeText } from '../core/bytes';
import { unwrap } from '../core/keys';
import type { DocumentStore } from '../core/doc-store';
import type { Approval } from '../sync/invite';
import { choicePin } from './account-keys-runtime';
import { deviceName, setDeviceName } from '../core/devices';
import { keepAll } from '../core/keeps';
import { hasData, type StorageLike } from '../core/account-setup';
import { STORAGE_PREFIX } from '../constants';
import type { SyncService } from '../sync/sync-service';
import type { AccountState } from './account-state';

/** Spaces with data that a device brought when it joined another account, added after the reload. */
const PENDING_KEY = `${STORAGE_PREFIX}-pending-local-spaces`;

/** localStorage, or a memory stand-in when the browser blocks it. */
export function safeStorage(): StorageLike {
  const memory = new Map<string, string>();
  return {
    getItem: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return memory.get(k) ?? null;
      }
    },
    setItem: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        memory.set(k, v);
      }
    },
  };
}

/**
 * This device joined an account and just received that account's document: make it this device's
 * account. Spaces of the old account that hold data are kept and added to the joined account after
 * the reload, with a name that does not clash ("Personal (Phone)"); empty ones are left behind.
 * The page reloads so every view starts from the joined account.
 */
export async function adoptAccount(accountId: string, state: AccountState, sync: SyncService, storage: StorageLike, me: string): Promise<void> {
  carryOver(accountId, state, storage, me);
  sync.setAccount(accountId);
  sync.log.log('pairing', `joined account ${accountId.slice(0, 8)}`);
  await new Promise((r) => setTimeout(r, 800));
  location.reload();
}

/** Keep this device's spaces with data and its name for the account it joins, and make that account this device's. */
function carryOver(accountId: string, state: AccountState, storage: StorageLike, me: string): void {
  const keep = state.current.spaces
    .filter((s) => {
      const doc = state.current.spaceDocs.get(s.id);
      const priv = state.current.privateDocs.get(s.id);
      return (doc && hasData(doc)) || (priv && hasData(priv));
    })
    .map((s) => ({ id: s.id, name: s.storedName }));
  // This device's name lives in the old account document; carry it over.
  const name = deviceName(state.doc, me);
  if (accountId === state.id) return;
  storage.setItem(PENDING_KEY, JSON.stringify({ spaces: keep, ...(name ? { name } : {}) }));
  storage.setItem(CURRENT_ACCOUNT_KEY, accountId);
}

/**
 * An enrolled device approved this one (one-time invite, #257). The signed records it sent go into
 * the joined account's document, this device follows the account key it compared, and the pairing
 * moves to the account's sync secret; after the reload the signed handshake brings the rest.
 */
export async function adoptApprovedAccount(a: Approval, o: { store: DocumentStore; state: AccountState; sync: SyncService; storage: StorageLike; me: string; agreeKey: CryptoKey }): Promise<void> {
  const secret = decodeText(await unwrap(o.agreeKey, a.secret));
  const doc = await o.store.open(accountDocId(a.accountId));
  doc.transact(() => {
    for (const [k, v] of a.records) keysMap(doc).set(k, v);
  });
  const key = (await readAccountKeys(doc)).find((k) => k.fingerprint === a.account);
  if (!key) throw new Error('The approval names no account key.');
  choicePin(o.storage).set({ fingerprint: a.account, sealed: true, publicKey: key.publicKey, by: key.by, ids: [a.accountId] });
  // The device keeps none of the account's spaces until chosen (S9, S-177); it lands on Settings, where the undecided-spaces notice asks.
  carryOver(a.accountId, o.state, o.storage, o.me);
  await o.sync.adoptPairing(secret, a.signalingUrl, a.accountId);
  o.sync.log.log('pairing', `approved into account ${a.accountId.slice(0, 8)}`);
  await new Promise((r) => setTimeout(r, 800));
  location.reload();
}

/**
 * A restored backup brought another account's document (a wiped or new browser restoring its
 * backup). A device in its own account with other devices adds the backup's spaces to that account;
 * any other device switches to the backup's account, keeping its own spaces that hold data.
 */
export async function takeRestoredAccount(
  accountId: string,
  open: (id: string) => Promise<import('yjs').Doc>,
  state: AccountState,
  sync: SyncService,
  storage: StorageLike,
  me: string,
): Promise<void> {
  const restored = await open(`account/${accountId}`);
  if (sync.pairedAccountId === state.id) {
    for (const s of readSpaces(restored)) {
      if (readSpaces(state.doc).some((x) => x.id === s.id)) continue;
      addSpace(state.doc, s.id, freeSpaceName(state.doc, s.storedName, 'restored'), undefined, me);
    }
    sync.log.log('storage', `added the spaces of restored account ${accountId.slice(0, 8)}`);
    await state.refresh();
    return;
  }
  // Restoring is asking for this data on this device: it keeps the restored account's spaces.
  keepAll(restored, me, readSpaces(restored).map((s) => s.id));
  await adoptAccount(accountId, state, sync, storage, me);
}

/** After a join, add the spaces this device brought, once the joined account's spaces have arrived. */
export async function addPendingLocalSpaces(state: AccountState, storage: StorageLike, me: string): Promise<void> {
  let parsed: { spaces?: { id: string; name: string }[]; name?: string } = {};
  try {
    parsed = JSON.parse(storage.getItem(PENDING_KEY) ?? '{}') as typeof parsed;
  } catch {
    parsed = {};
  }
  const pending = Array.isArray(parsed.spaces) ? parsed.spaces : [];
  if (pending.length === 0 && !parsed.name) return;
  // Wait for the joined account's spaces, so names are compared with what is there (at most 15 s).
  const start = Date.now();
  while (readSpaces(state.doc).length === 0 && Date.now() - start < 15_000) await new Promise((r) => setTimeout(r, 250));
  if (parsed.name && !deviceName(state.doc, me)) setDeviceName(state.doc, me, parsed.name);
  const hint = deviceName(state.doc, me) ?? 'this device';
  for (const p of pending) {
    if (readSpaces(state.doc).some((s) => s.id === p.id)) continue;
    addSpace(state.doc, p.id, freeSpaceName(state.doc, p.name, hint), undefined, me);
  }
  storage.setItem(PENDING_KEY, '{}');
  await state.refresh();
}
