import type { RoomKind } from '../core/protocol-ids';
import type * as Y from 'yjs';
import { STORAGE_PREFIX } from '../constants';
import { spacesMap } from '../core/account';
import { noteSharedSince } from '../core/account-labels';
import { keysMap, readAccountKeys } from '../core/account-keys';
import type { StorageLike } from '../core/account-setup';
import { spaceDocId, type DocumentStore } from '../core/doc-store';
import { keepsMap } from '../core/keeps';
import { readRemovals } from '../core/key-removals';
import {
  addMember,
  clearShareAnchor,
  copyOwnRecords,
  createShare,
  emptyPins,
  endMember,
  nextGeneration,
  readShare,
  rosterRecords,
  rosterRecordsFor,
  setShareAnchor,
  shareMap,
  sharedSpaces,
  type SharePinStore,
  type SharePins,
  type ShareState,
} from '../core/shares';
import { generateSecret, normalizeSecret } from '../sync/pairing-secret';
import type { PeerInfo } from '../sync/peer-mesh';
import type { ShareApprovalMessage, ShareAsk } from '../sync/share-link';
import { SyncService } from '../sync/sync-service';
import { createTransport as defaultTransport, defaultSignalingUrl } from '../sync/transport-factory';
import type { SignalingTransport } from '../sync/signaling';
import type { AccountState } from './account-state';
import type { AccountKeys, KeyTrust } from './account-keys-runtime';
import { applyShareTrust, ShareTrust } from './share-trust';
import { createFileHost } from './file-host';
import { allowsShareDoc, allowsShareFile } from './sync-filter';

/**
 * Shares in the running app (#259, S-259): for every space this account takes part in as a share, the
 * roster is read from the space document, a `ShareTrust` is kept, this device copies its own account's
 * certificates into the roster, and, while this account is an active member and the device is certified,
 * one `SyncService` runs the share's mesh (`allowsShareDoc`: the space document only). Obsidian runs none.
 */

const PINS_KEY = `${STORAGE_PREFIX}-share-pins`;

/** Pins in localStorage, one entry per share (`SharePinStore`). */
export function storedPins(storage: StorageLike): SharePinStore {
  const read = (): Record<string, SharePins> => {
    try {
      return JSON.parse(storage.getItem(PINS_KEY) ?? '{}') as Record<string, SharePins>;
    } catch {
      return {};
    }
  };
  return {
    load(space) {
      const p = read()[space];
      return p && typeof p === 'object' ? { ends: { ...(p.ends ?? {}) }, removed: [...(p.removed ?? [])] } : emptyPins();
    },
    save(space, pins) {
      storage.setItem(PINS_KEY, JSON.stringify({ ...read(), [space]: pins }));
    },
  };
}

export interface ShareView {
  space: string;
  /** The roster as this device reads it; undefined while the space is not (or no longer) a share here. */
  state: ShareState | undefined;
  /** This account is the owner. */
  owner: boolean;
  /** This account is an active member (the owner counts). */
  active: boolean;
  /** Linked devices of other accounts, by account. */
  connected: Map<string, number>;
  peers: PeerInfo[];
}

interface Entry {
  space: string;
  trust: ShareTrust;
  svc: SyncService | undefined;
  state: ShareState | undefined;
  observing: Y.Doc | undefined;
  stopStatus: (() => void) | undefined;
}

export interface SharesDeps {
  store: DocumentStore;
  state: AccountState;
  trust: KeyTrust;
  keys: () => AccountKeys;
  me: string;
  storage: StorageLike;
  log(detail: string): void;
  transport?: (url: string, kind?: RoomKind) => SignalingTransport;
}

export class Shares {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private pins!: SharePinStore;
  private deps!: SharesDeps;
  private running: Promise<void> = Promise.resolve();
  private queued = false;

  start(deps: SharesDeps): void {
    this.deps = deps;
    this.pins = storedPins(deps.storage);
    const kick = (): void => this.kick();
    spacesMap(deps.state.doc).observe(kick);
    keepsMap(deps.state.doc).observe(kick);
    keysMap(deps.state.doc).observe(kick);
    deps.state.subscribe(kick);
    deps.trust.subscribe(kick);
    kick();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Look at every share again (queued; many changes in a row need one run). */
  kick(): void {
    if (this.queued) return;
    this.queued = true;
    this.running = this.running.then(async () => {
      this.queued = false;
      await this.refresh().catch((e: unknown) => this.deps.log(`shares: ${e instanceof Error ? e.message : String(e)}`));
    });
  }

  /** Wait until the roster of every share is read again. */
  async settled(): Promise<void> {
    this.kick();
    await this.running;
  }

  /** The mesh's event log and peers for one share (test builds print it when a suite fails). */
  debugText(space: string): string {
    const e = this.entries.get(space);
    if (!e?.svc) return '(no mesh)';
    const svc = e.svc;
    const trusted = svc.status.peers.map((p) => `${p.id.slice(0, 8)} verified=${svc.isVerified(p.id)} trusted=${e.trust.peer(p.id) !== undefined} account=${e.trust.accountOf.get(p.id)?.slice(0, 6)}`);
    return `trust active=${e.trust.active} proof=${!!e.trust.proof} peers=[${[...e.trust.peers.keys()].map((i) => i.slice(0, 8))}]\n${trusted.join('\n')}\npeers ${JSON.stringify(svc.status.peers)}\n${svc.log.toText()}`;
  }

  pinsOf(space: string): SharePins {
    return this.pins.load(space);
  }

  view(space: string): ShareView | undefined {
    const e = this.entries.get(space);
    if (!e?.state) return undefined;
    const peers = e.svc?.status.peers ?? [];
    const connected = new Map<string, number>();
    for (const p of peers) {
      const fp = e.trust.accountOf.get(p.id);
      if (fp && p.state === 'connected') connected.set(fp, (connected.get(fp) ?? 0) + 1);
    }
    const fp = this.deps.trust.accountFp;
    return { space, state: e.state, owner: !!fp && e.state.owner === fp, active: e.trust.active, connected, peers };
  }

  private async refresh(): Promise<void> {
    const { state: account, trust, store } = this.deps;
    const anchors = sharedSpaces(account.doc);
    for (const space of [...this.entries.keys()]) {
      if (!anchors.has(space)) this.drop(space);
    }
    const ownFp = trust.accountFp;
    for (const [space, owner] of anchors) {
      const e = this.entry(space);
      // Only an account that requires device keys takes part, and only on a device that keeps the space.
      if (!trust.required() || !ownFp || !account.keepsSpace(space)) {
        e.state = undefined;
        applyShareTrust(e.trust, ownFp, undefined, undefined);
        this.stopMesh(e);
        continue;
      }
      const doc = await store.open(spaceDocId(space));
      if (e.observing !== doc) {
        e.observing?.getMap('share').unobserve(this.onRoster);
        e.observing = doc;
        shareMap(doc).observe(this.onRoster);
      }
      e.state = await readShare(doc, space, owner, this.pins);
      const proof = trust.proof;
      const changed = applyShareTrust(e.trust, ownFp, proof, e.state);
      if (e.state && e.trust.active && proof) {
        await this.copyOwn(doc, e.state, ownFp);
        this.ensureMesh(e, e.state);
      } else {
        this.stopMesh(e);
      }
      if (changed && e.svc) {
        e.svc.keysChanged();
        // Someone may now be allowed that was refused before (a member added again): say hello at once, not at the next timer.
        if (e.trust.active) e.svc.reconnect();
      }
    }
    this.emit();
  }

  private readonly onRoster = (): void => this.kick();

  private entry(space: string): Entry {
    let e = this.entries.get(space);
    if (!e) {
      e = { space, trust: new ShareTrust(), svc: undefined, state: undefined, observing: undefined, stopStatus: undefined };
      this.entries.set(space, e);
    }
    return e;
  }

  private drop(space: string): void {
    const e = this.entries.get(space);
    if (!e) return;
    this.stopMesh(e);
    e.observing?.getMap('share').unobserve(this.onRoster);
    this.entries.delete(space);
  }

  private async copyOwn(doc: Y.Doc, state: ShareState, ownFp: string): Promise<void> {
    const { state: account, trust } = this.deps;
    const record = (await readAccountKeys(account.doc)).find((k) => k.fingerprint === ownFp);
    const removals = await readRemovals(account.doc, record);
    const n = copyOwnRecords(doc, state, { fp: ownFp, certs: trust.certs, removals, keys: keysMap(account.doc) });
    if (n > 0) {
      this.deps.log(`share ${state.space.slice(0, 8)}: copied ${n} record(s) of this account into the roster`);
      this.kick();
    }
  }

  private ensureMesh(e: Entry, state: ShareState): void {
    const { store, me } = this.deps;
    if (!e.svc) {
      const space = e.space;
      const verified = (peerId: string): boolean => svc.isVerified(peerId) && e.trust.peer(peerId) !== undefined;
      const svc: SyncService = new SyncService(store, {
        deviceId: me,
        createTransport: this.deps.transport ?? defaultTransport,
        roomKind: 's',
        storageKey: `${STORAGE_PREFIX}-share-${space}`,
        realAddresses: false,
        identity: e.trust,
        isBlocked: (id) => e.trust.blocked(id),
        // The space document only, to a verified peer an active member account vouches for.
        allowDoc: (docId, peerId) => allowsShareDoc({ docId, space, peerVerified: verified(peerId) }),
        // The space's files, fetched from and sent to the same peers, on direct links only (#272).
        files: createFileHost({
          store,
          keepsSpace: (id) => id === space,
          allow: (unit, peerId) => allowsShareFile({ unit, space, peerVerified: verified(peerId) }),
          log: (t) => svc.log.log('file', t),
        }),
      });
      e.svc = svc;
      svc.start();
      e.stopStatus = svc.subscribe(() => this.emit());
    }
    const svc = e.svc;
    const secret = normalizeSecret(state.secret);
    if (svc.secret !== undefined && svc.secret !== secret) svc.unpair();
    if (svc.secret === undefined) void svc.join(secret, defaultSignalingUrl()).then(() => this.deps.log(`share ${e.space.slice(0, 8)}: mesh started`));
  }

  private stopMesh(e: Entry): void {
    if (e.svc?.status.paired) {
      e.svc.unpair();
      this.deps.log(`share ${e.space.slice(0, 8)}: mesh stopped`);
    }
  }

  // --- actions ---

  /** The owner makes the space a share (if it is not one yet) and trusts itself as owner. Needs the passphrase unlocked. */
  async create(space: string, name: string): Promise<ShareState> {
    const { state: account, store, trust } = this.deps;
    if (!trust.required()) throw new Error('Device keys are required first.');
    const record = (await readAccountKeys(account.doc)).find((k) => k.fingerprint === trust.accountFp);
    if (!record) throw new Error('The account key is missing.');
    const doc = await store.open(spaceDocId(space));
    await this.deps.keys().signing(({ fp, key }) => createShare(doc, space, fp, record.publicKey, key, normalizeSecret(generateSecret()), name));
    setShareAnchor(account.doc, space, record.fingerprint);
    await this.settled();
    const state = this.entries.get(space)?.state;
    if (!state) throw new Error('The share could not be set up.');
    return state;
  }

  /** The owner adds the asking account and returns the records it needs. Needs the passphrase unlocked. */
  async approve(space: string, ask: ShareAsk): Promise<ShareApprovalMessage> {
    const { store } = this.deps;
    const state = this.entries.get(space)?.state;
    if (!state) throw new Error('This space is not shared from this device.');
    const doc = await store.open(spaceDocId(space));
    const records = await rosterRecordsFor(ask.account, ask.key, ask.records);
    if (!records.some(([k]) => k === `cert:${ask.account}:${ask.deviceId}`)) throw new Error('That device is not approved in its account yet.');
    const n = nextGeneration(doc, ask.account, this.pins.load(space));
    await this.deps.keys().signing(({ key }) => addMember(doc, space, key, { fp: ask.account, key: ask.key, n, ...(ask.name ? { name: ask.name } : {}) }, records));
    noteSharedSince(this.deps.state.doc, space, ask.account);
    await this.settled();
    const own = rosterRecords(doc).filter(([k]) => k === 'share' || k === `member:${ask.account}` || k.startsWith('name:') || k.startsWith(`cert:${state.owner}:`) || k.startsWith(`removal:${state.owner}:`));
    return { account: state.owner, space, spaceName: this.deps.state.current.allSpaces.find((s) => s.id === space)?.storedName ?? 'Shared space', records: own };
  }

  /** The owner ends a member. Needs the passphrase unlocked. */
  async end(space: string, fp: string): Promise<void> {
    const state = this.entries.get(space)?.state;
    const member = state?.members.get(fp);
    if (!state || !member || fp === state.owner) throw new Error('That account is not a member.');
    const doc = await this.deps.store.open(spaceDocId(space));
    await this.deps.keys().signing(({ key }) => endMember(doc, space, key, fp, member.n));
    await this.settled();
  }

  /** A member leaves: no record, no passphrase. The space stays here as an ordinary space. */
  async leave(space: string): Promise<void> {
    clearShareAnchor(this.deps.state.doc, space);
    await this.settled();
  }
}

/** One per page; `main.tsx` starts it. */
export const shares = new Shares();
