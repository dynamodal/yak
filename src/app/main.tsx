import './theme/tokens.css';
import { testMode } from '../core/test-build';
import './app.css';
import './ui/ui.css';
import { render } from 'preact';
import * as Y from 'yjs';
import { createRecord } from '../core/schema';
import { trashRecord, type TrashKind } from '../core/trash';
import { bus } from '../core/bus';
import { deviceId } from '../core/device';
import { accountDocId, accountLogDocId, accountOfDoc, LEGACY_ACCOUNT_KEY, readSpaces } from '../core/account';
import { spaceLogDocId, spaceOfDoc } from '../core/doc-store';
import { devicesMap, isRemoved, readDevices, setLeft } from '../core/devices';
import { keepsMap } from '../core/keeps';
import { DocumentStore } from '../core/doc-store';
import { ensureDefaultSpaces, prepareAccount } from '../core/account-setup';
import { legacyAccountId } from '../core/account-move';
import type { AccountKeys } from './account-keys-runtime';
import { keyTrust, markAccountSynced, newAccountKey, NO_ACCOUNT_KEYS, ownerKeys, settleOnStart, startAccountKeys } from './account-keys-runtime';
import { joinState } from './join-state';
import { shares } from './shares-runtime';
import { shareLinks } from './share-links';
import { keyPrompt } from './key-prompt';
import { requestPersistence } from '../core/persistence';
import { completePendingReplace, replacePending } from '../backup/replace';
import { STORAGE_PREFIX } from '../constants';
import { startOffline } from '../offline/client';
import { logSharingOn, onLogSharingChange } from '../sync/log-sharing';
import { SharedLogWriter } from '../sync/shared-log';
import { SyncService, type SyncStatus } from '../sync/sync-service';
import { createTransport } from '../sync/transport-factory';
import { friendlyDocId, testDocId } from '../core/test-ids';
import { AccountState } from './account-state';
import { initKeeps } from './keeps-init';
import { migrateDevice } from '../core/migrations';
import { addNotice } from '../core/notices';
import { allowsDoc } from './sync-filter';
import { createFileHost } from './file-host';
import { startFileSweep } from './file-sweep';
import { createAttachmentHost } from '../core/blobs/host';
import { blobStore } from '../core/blobs/store';
import { applyPendingErase } from './leave';
import { applyPendingReset } from './reset';
import type { EraseStorage } from './erase-device';
import { historyStore } from '../core/history/store';
import { adoptAccount, addPendingLocalSpaces, safeStorage, takeRestoredAccount } from './join';
import { App } from './App';
import { setPendingJoins } from './needs';
import { captureErrors } from './error-capture';
import { toast } from './ui/Toast';
import { REPORT_HASH } from '../constants';
import { checkStorage, describeProblem, renderBootFailure } from './boot-failure';
import { installLightDarkFallback } from './theme/light-dark';

declare const __APP_VERSION__: string | undefined;
declare const __TEST_BUILD__: boolean;
import './modules';

async function boot(root: HTMLElement, started: () => void): Promise<void> {
  const store = new DocumentStore(undefined, (step, detail) => sync.log.log('migration', `${step}: ${detail}`));
  const me = deviceId();
  // The account and its spaces (docs/sync.md). Set up before sync starts; a device that is
  // paired but has no account yet derives its account id from the sync code, as its other devices do.
  let state: AccountState | undefined;
  let accountKeys: AccountKeys = NO_ACCOUNT_KEYS;
  const bootStorage = safeStorage();
  const allowDocFor = (docId: string, peerId: string): boolean =>
    state !== undefined &&
    !store.isTooNew(docId) &&
    allowsDoc({
      docId,
      peerId,
      account: state.doc,
      accountId: state.id,
      me,
      paired: sync.status.paired,
      pairedAccountId: sync.pairedAccountId,
      keys: {
        required: keyTrust.required(),
        // Proven, and still certified now: a certificate that stopped counting (the switch, #257) stops an open link from carrying anything.
        peerVerified: sync.isVerified(peerId) && keyTrust.peer(peerId) !== undefined,
        peerHolds: (space) => keyTrust.holds(space, peerId),
      },
    });
  const sync: SyncService = new SyncService(store, {
    deviceId: me,
    createTransport,
    // With keys required only a signed removal blocks (#258); otherwise the cooperative flag.
    isBlocked: (id) => (state ? keyTrust.blocked(id, isRemoved(state.doc, id)) : false),
    accountId: () => state?.id ?? '',
    // Certified device keys: signed handshake and pair keys (#256). `?test&slice1` syncs as the slice 1 build did (mixed-version tests).
    ...(testMode() && new URLSearchParams(location.search).has('slice1') ? {} : { identity: keyTrust }),
    // The account document always syncs (so spaces can be chosen); a space only between two devices
    // that both keep it.
    allowDoc: allowDocFor,
    // Files of a space go to the peers that may have the space's documents; direct links only (#166).
    files: createFileHost({ store, keepsSpace: (id) => state?.keepsSpace(id) ?? false, allow: (unit, peerId) => allowDocFor(`space/${unit}`, peerId), log: (t) => sync.log.log('file', t) }),
    // A paired device that never learned its pairing's account (it rejoined the account it already
    // had, so no other account document arrives to adopt) learns it when a peer sends this device's
    // own account document; without it every space and log stays refused.
    onDocReceived: (docId) => {
      // A peer sent this account's document: a paired device may now make an account key if there is none (src/core/account-move.ts).
      if (state && docId === `account/${state.id}` && markAccountSynced(bootStorage)) accountKeys.kick();
      if (state && sync.status.paired && !sync.pairedAccountId && docId === `account/${state.id}`) {
        sync.setAccount(state.id);
        sync.refilter();
      }
    },
    // Joining the account again clears this device's "left" mark, so the others list it again.
    onPairingStarted: () => {
      if (state) setLeft(state.doc, me, false);
    },
  });
  // As early as the log exists, so a failure in the rest of start-up is recorded too.
  captureErrors({
    log: sync.log,
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development',
    page: () => location.hash || '#/',
    notify: () => toast('Something went wrong.', { action: { label: 'Report it', run: () => void (location.hash = REPORT_HASH) }, timeout: 15000 }),
  });

  const storage = safeStorage();
  // A backup replace started before the reload is applied first, so the restored account document is
  // what the app starts from (the documents are empty until then).
  if (replacePending()) await completePendingReplace((id) => store.open(id));
  // Local copies this device chose to erase when it left the account (before any document is opened).
  await applyPendingErase(storage);
  // A reset of this device's data chosen on the Devices page (docs/sync.md).
  await applyPendingReset(storage, { clearHistory: (id) => historyStore.removeDoc(id).catch(() => undefined) });
  // Device-local data migrations (F39), before any document opens.
  await migrateDevice(storage, undefined, (step, detail) => sync.log.log('migration', `${step}: ${detail}`));
  const pairedSecret = sync.storedSecret();
  const newKey = newAccountKey(me);
  let prepared = await prepareAccount(store, { storage, ...(pairedSecret ? { pairedSecret } : {}), ...(newKey ? { newKey } : {}) });
  // The account moves to its fingerprint id (S-76r, F39): a first start with the keys makes the account key and copies the account document.
  const derivedId = prepared.derived ? prepared.id : undefined;
  // The id before the move: its document may still be open in this session, and is not a restored account.
  const idBeforeMove = prepared.id;
  if (await settleOnStart(store, storage, me, prepared.id, prepared.doc, pairedSecret !== undefined, (d) => sync.log.log('migration', d))) {
    prepared = await prepareAccount(store, { storage, ...(pairedSecret ? { pairedSecret } : {}) });
  }
  // An account that moved to its fingerprint id kept its old id for older builds (S-76r). No build uses it any more (#295):
  // fold the old account document and shared log into the new ones once, then move the pairing (below). The old databases stay on disk.
  const legacy = legacyAccountId(storage);
  const droppedLegacy = legacy && legacy !== prepared.id ? legacy : undefined;
  if (droppedLegacy) {
    Y.applyUpdate(prepared.doc, Y.encodeStateAsUpdate(await store.open(accountDocId(droppedLegacy))));
    Y.applyUpdate(await store.open(accountLogDocId(prepared.id)), Y.encodeStateAsUpdate(await store.open(accountLogDocId(droppedLegacy))));
    sync.log.log('migration', `folded the old account document ${droppedLegacy.slice(0, 8)} into the current one`);
  }
  if (legacy) storage.setItem(LEGACY_ACCOUNT_KEY, '');
  const account = prepared.doc;
  // A device with no account spaces and no sync code shows the welcome and creates nothing until a
  // choice is made. Test pages (`?test`) keep the two default spaces unless they ask for `?welcome`.
  const query = new URLSearchParams(location.search);
  const welcome = readSpaces(account).length === 0 && !pairedSecret && (!testMode() || query.has('welcome'));
  if (readSpaces(account).length === 0 && !pairedSecret && !welcome) ensureDefaultSpaces(account, undefined, me);
  // Which spaces each device keeps lives in the account document; the first start with it writes this
  // device's choices (and those of the devices it already syncs with) from what they had before.
  if (initKeeps(account, me, storage, { peers: sync.knownPeers(), peerSpaces: sync.legacyPeerSpaces() })) sync.clearLegacyPeerChoices();
  state = new AccountState(prepared.id, account, store, me);
  await state.refresh();
  const accountState = state;
  // Spaces kept on this device when it joined another account (see adoptAccount) join that account.
  void addPendingLocalSpaces(accountState, storage, me);

  // The shared debug log: this device's events go to the account log and to the logs of spaces it
  // keeps, which sync to the devices that keep them (always on during alpha; docs/decisions/sync.md).
  const logWriter = new SharedLogWriter({
    log: sync.log,
    device: me,
    enabled: logSharingOn,
    allLogs: () => Promise.all([accountLogDocId(accountState.id), ...[...accountState.spaceIds()].filter((id) => accountState.keepsSpace(id)).map(spaceLogDocId)].map((id) => store.open(id))),
    openAccountLog: () => store.open(accountLogDocId(accountState.id)),
    openSpaceLog: (id) => (accountState.keepsSpace(id) ? store.open(spaceLogDocId(id)) : undefined),
  });
  logWriter.start();
  // Turning sharing off removes this device's lines; the removal reaches the other devices by sync.
  onLogSharingChange((on) => {
    if (!on) void logWriter.clearOwn();
  });
  const openSpaceLogs = (): void => accountState.spaceIds().forEach((id) => void store.open(spaceLogDocId(id)));
  openSpaceLogs();
  accountState.subscribe(openSpaceLogs);

  // A document written by a newer app stays untouched here (F39): it stops syncing and a notice says to update.
  store.onTooNew((docId) => {
    addNotice({ key: `update-needed:${docId}`, kind: 'update-needed', text: 'Another device has a newer version of Yak. Reload this page to update; until then this device does not sync some data.' });
    sync.refilter();
  });

  sync.start();
  accountKeys = startAccountKeys({ store, storage, me, sync, bus, state: accountState, log: (d) => sync.log.log('keys', d) });
  ownerKeys.current = accountKeys;
  keyPrompt.configure({ me, paired: () => sync.status.paired });
  // Invites load on demand: the first load carries only the join state (#257).
  // Shared spaces (#259): the roster of each share, and its mesh while this account is an active member.
  shares.start({ store, state: accountState, trust: keyTrust, keys: () => ownerKeys.current, me, storage, log: (d) => sync.log.log('share', d) });
  shareLinks.configure({ store, state: accountState, trust: keyTrust, keys: () => ownerKeys.current, shares, me, storage });
  const shareLinksLoaded = Promise.resolve(shareLinks);
  const invitesLoaded = import('./invites').then(({ invites }) => (invites.configure({ store, state: accountState, sync, storage, me }), invites));
  if (droppedLegacy && sync.pairedAccountId === droppedLegacy) sync.setAccount(accountState.id);
  bus.on('passphrase:ready', ({ passphrase }) => void accountKeys.passphraseTyped(passphrase).catch((e: unknown) => sync.log.log('keys', `passphrase: ${e instanceof Error ? e.message : String(e)}`)));
  // A pairing from before accounts belongs to the account derived from its sync code.
  if (pairedSecret && derivedId && !sync.pairedAccountId) sync.setAccount(derivedId);
  // Joining: the account document of the account joined arrives from a peer; adopt it.
  store.onOpened((id) => {
    const other = accountOfDoc(id);
    if (other && other !== accountState.id && other !== droppedLegacy && other !== idBeforeMove && sync.status.paired && !sync.pairedAccountId) {
      void adoptAccount(other, accountState, sync, storage, me);
    }
  });

  // A restored backup of another account (for example a wiped browser restoring its backup).
  bus.on('backup:restored', ({ docIds }) => {
    const other = docIds.map(accountOfDoc).find((id) => id !== undefined && id !== accountState.id && id !== droppedLegacy && id !== idBeforeMove);
    if (other) void takeRestoredAccount(other, (id) => store.open(id), accountState, sync, storage, me);
  });

  // A change in which spaces devices keep applies to the open links at once.
  keepsMap(account).observe(() => sync.refilter());

  // A device removed on any of the owner's devices, or that left the account, is disconnected here
  // too, after a moment so the change itself still reaches it; allowed again (or back after leaving),
  // it is contacted at once.
  const removedNow = (): Set<string> => new Set([...readDevices(account)].filter(([id, d]) => (d.removed || d.left) && id !== me).map(([id]) => id));
  let wasRemoved = removedNow();
  devicesMap(account).observe(() => {
    const now = removedNow();
    for (const id of now) {
      if (wasRemoved.has(id)) continue;
      setTimeout(() => {
        const info = readDevices(account).get(id);
        if ((info && keyTrust.blocked(id, info.removed)) || info?.left) sync.forget(id);
      }, 1500);
    }
    for (const id of wasRemoved) if (!now.has(id)) sync.allow(id);
    wasRemoved = now;
  });
  void requestPersistence().then((r) => sync.log.log('storage', `persistence ${r}`));

  startFileSweep(store, () => account);
  render(<App store={store} sync={sync} bus={bus} deviceId={me} account={accountState} welcome={welcome} />, root);
  started();
  const eraseStore = rawStorage();
  if (eraseStore?.getItem(`${STORAGE_PREFIX}-erase-report`) != null) void import('./erase-device').then((m) => ((t) => t && toast(t, { timeout: 0 }))(m.takeEraseReport(eraseStore)));

  // Offline support: production builds only, so `npm run dev` is never served from a cache.
  if (import.meta.env.PROD) void startOffline();

  // Test hook for automated browsers, only with `?test` in the URL.
  // `__TEST_BUILD__` is spelled out so the bundler drops the whole block from a production build (it does not fold `testMode()` across modules).
  if (__TEST_BUILD__ && testMode()) {
    (window as unknown as { __app: unknown }).__app = {
      state: () => sync.status.state,
      otherTab: () => sync.status.otherTab === true,
      peers: () => sync.status.peers.map((p) => ({ id: p.id, state: p.state })),
      deviceId: () => me,
      dropLink: (peerId?: string) => sync.dropForTest(peerId),
      /** Show this sync status instead of the real one (`null` restores it): the header's sync shapes without real devices. */
      /** Pretend devices wait for approval (`[]` clears): the Needs you rows without a second device. */
      fakePendingJoins: (list: { deviceId: string; name?: string; expiresAt: number }[]) => setPendingJoins(list),
      fakeStatus: (s: Partial<SyncStatus> | null) => sync.setStatusForTest(s ? { paired: false, state: 'stopped', peers: [], signalingUrl: '', signalingProblem: false, ...s } : undefined),
      /** Device keys (#256): sign "keys required" with the account key this device holds; what this device knows. */
      requireKeys: () => accountKeys.requireKeysForTest?.() ?? Promise.resolve(false),
      /** Slice 3 (#257): unlock with the passphrase, the switch with approvals, approve a known device. */
      unlock: (passphrase: string) => accountKeys.unlock(passphrase),
      switchKeys: (approved: string[]) => accountKeys.requireKeys(approved),
      approve: (deviceId: string) => accountKeys.approve(deviceId).then(() => true),
      /** Slice 4 (#258): remove a device with the unlocked key; this device's sync secret. */
      removeDevice: (deviceId: string) => accountKeys.removeDevice(deviceId).then(() => true),
      secret: () => sync.secret,
      /** A keyless account as before #311 (test builds only): start or join with the account's own sync code, to test the switch. */
      startKeyless: () => sync.startNewPairing(),
      joinKeyless: (code: string) => sync.join(code),
      /** A base64 Yjs update of a whole document (tests hand it to another device, as a device that is behind would). */
      encodeDoc: (id: string) => {
        const doc = store.get(testDocId(store, id));
        return doc ? btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc))) : undefined;
      },
      /** One-time invites (#257): open one and read its code and requests; approve a request. */
      openInvite: async () => {
        const invites = await invitesLoaded;
        await invites.open();
        return invites.hosting?.code;
      },
      invite: async () => {
        const h = (await invitesLoaded).hosting;
        return h && { code: h.code, requests: h.requests.map((r) => ({ id: r.request.deviceId, compare: r.compare, state: r.state })), oldBuilds: h.oldBuilds };
      },
      approveJoin: async (id: string) => (await (await invitesLoaded).approve(id), true),
      joinState: () => joinState.get(),
      /** Sharing (#259): open a link for a space (by name), read it, approve an ask; the other account asks, confirms and reads its state. */
      shareOpen: async (space: string, name: string) => {
        const links = await shareLinksLoaded;
        await links.open(accountState.current.allSpaces.find((s) => s.storedName.toLowerCase() === space.toLowerCase())?.id ?? space, name);
        return links.hosting?.code;
      },
      shareHost: async () => {
        const h = (await shareLinksLoaded).hosting;
        return h && { code: h.code, used: h.used, requests: h.requests.map((r) => ({ id: r.ask.deviceId, name: r.ask.name, compare: r.compare, state: r.state, error: r.error })) };
      },
      shareApprove: async (id: string) => (await (await shareLinksLoaded).approve(id), true),
      shareAsk: async (code: string, name: string) => (await (await shareLinksLoaded).ask(code, name), true),
      shareConfirm: async () => ((await shareLinksLoaded).confirm(), true),
      shareJoin: async () => (await shareLinksLoaded).join,
      shareEnd: async (space: string, fp: string) => (await shares.end(accountState.current.allSpaces.find((s) => s.storedName.toLowerCase() === space.toLowerCase())?.id ?? space, fp), true),
      shareLeave: async (space: string) => (await shares.leave(accountState.current.allSpaces.find((s) => s.storedName.toLowerCase() === space.toLowerCase())?.id ?? space), true),
      shareView: (space: string) => {
        const v = shares.view(accountState.current.allSpaces.find((s) => s.storedName.toLowerCase() === space.toLowerCase())?.id ?? space);
        return v && { owner: v.owner, active: v.active, members: [...(v.state?.members.keys() ?? [])], ended: [...(v.state?.ended ?? [])], connected: [...v.connected], devices: [...(v.state?.devices.keys() ?? [])] };
      },
      shareDebug: (space: string) => shares.debugText(accountState.current.allSpaces.find((s) => s.storedName.toLowerCase() === space.toLowerCase())?.id ?? space) + '\n--- main log\n' + sync.log.toText(),
      accountFp: () => keyTrust.accountFp,
      pairedAccountId: () => sync.pairedAccountId,
      keys: () => ({ required: keyTrust.required(), certified: keyTrust.proof !== undefined, certs: [...keyTrust.certs.keys()], verified: sync.status.peers.filter((p) => sync.isVerified(p.id)).map((p) => p.id) }),
      report: () => sync.report(),
      docs: () => [...store.opened().keys()].map((id) => friendlyDocId(store, id)),
      accountId: () => accountState.id,
      /** Space ids by lower-case name, for tests: `{ personal: '…', work: '…' }`. Kept spaces only. */
      spaces: () => Object.fromEntries(accountState.current.spaces.map((sp) => [sp.storedName.toLowerCase(), sp.id])),
      allSpaces: () => Object.fromEntries(accountState.current.allSpaces.map((sp) => [sp.storedName.toLowerCase(), sp.id])),
      // Tests name documents by the first layout's ids (`space/personal`, `space/work/time`); see core/test-ids.ts.
      text: (id: string, name: string) => store.get(testDocId(store, id))?.getText(name).toString(),
      json: (id: string, name: string) => store.get(testDocId(store, id))?.getMap(name).toJSON(),
      /** Merge a base64 Yjs update into a document (the performance script seeds a year of data this way). */
      applyUpdate: (id: string, base64: string) => {
        const doc = store.get(testDocId(store, id));
        if (doc) Y.applyUpdate(doc, Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      },
      /** Files (#166): add a text file to a space, and the bytes of files held for it on this device. */
      addFile: async (id: string, name: string, text: string) => {
        const real = testDocId(store, id);
        const doc = store.get(real);
        const unit = spaceOfDoc(real);
        if (doc && unit) await createAttachmentHost(doc, unit).add([new File([text], name)]);
      },
      fileBytes: async (id: string) => {
        const unit = spaceOfDoc(testDocId(store, id));
        return unit ? blobStore(unit).totalSize() : 0;
      },
      /** Recently deleted (B-107): make a record (a note's `text` becomes a Y.Text) and delete it with the stamp, as the app's deletes do. */
      addRecord: (id: string, name: 'time_entries' | 'notes' | 'projects' | 'clients' | 'tags', fields: Record<string, unknown>) => {
        const doc = store.get(testDocId(store, id));
        return doc ? createRecord(doc, name, typeof fields.text === 'string' ? { ...fields, text: new Y.Text(fields.text) } : fields) : undefined;
      },
      trash: (id: string, kind: TrashKind, recordId: string) => {
        const doc = store.get(testDocId(store, id));
        return doc ? trashRecord(doc, kind, recordId) : false;
      },
      /** Set or delete one entry of a map in a document (tests drive notes and roster records this way). */
      mapSet: (id: string, map: string, key: string, value: unknown) => void store.get(testDocId(store, id))?.getMap(map).set(key, value),
      mapDelete: (id: string, map: string, key: string) => void store.get(testDocId(store, id))?.getMap(map).delete(key),
      append: (id: string, name: string, text: string) => {
        const t = store.get(testDocId(store, id))?.getText(name);
        t?.insert(t.length, text);
      },
    };
  }
}

/** Longest the first start-up may take before the screen says so (a stuck IndexedDB never answers). */
const BOOT_WATCHDOG_MS = 60_000;

/** `localStorage` when this browser allows it. */
function rawStorage(): EraseStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

async function start(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  // Theme colours in browsers without CSS light-dark() (Safari before 17.5, #7).
  installLightDarkFallback();
  let done = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const fail = (problem: 'no-storage' | 'slow' | 'error', detail: string): void => {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    renderBootFailure(root, problem, detail);
  };
  // "Erase everything on this device" chosen before the reload: first of all, before any module reads or opens a store (docs/decisions/sync.md S-61).
  const eraseStorage = rawStorage();
  if (eraseStorage?.getItem(`${STORAGE_PREFIX}-erase-everything`) != null) {
    // Loaded only when an erase is pending (the main bundle is on a budget).
    await (await import('./erase-device')).applyPendingEraseAll(eraseStorage);
    location.reload();
    return;
  }
  // Feature-detect the one thing nothing works without, before touching anything else.
  const storage = await checkStorage();
  if (!storage.ok) return fail('no-storage', storage.detail);
  watchdog = setTimeout(() => fail('slow', `start-up did not finish in ${BOOT_WATCHDOG_MS / 1000} s`), BOOT_WATCHDOG_MS);
  try {
    await boot(root, () => {
      done = true;
      clearTimeout(watchdog);
    });
  } catch (e) {
    // The error capture, if it was already installed, has logged this too.
    fail('error', describeProblem(e));
  }
}

void start();
