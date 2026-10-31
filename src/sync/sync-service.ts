import type { RoomKind } from '../core/protocol-ids';
import { STORAGE_PREFIX } from '../constants';
import { DocMux, FRAME_FILE_PIECE, decodeControl, encodeControl } from './doc-mux';
import { FileTransfer, type FileHost } from './file-transfer';
import { DocSync } from './doc-sync';
import { type DocumentStore, isLogDoc, isValidDocId, spaceOfDoc } from '../core/doc-store';
import { EventLog, watchEnvironment } from './event-log';
import type { LinkState } from './types';
import { deriveKeys, generateSecret, normalizeSecret } from './pairing-secret';
import { PeerLink } from './peer-link';
import { PeerMesh, type PeerInfo } from './peer-mesh';
import type { SyncIdentity } from './handshake';
import { loadIceUrls, toIceServers } from './ice-servers';
import { ensureRealAddresses } from './real-addresses';
import { NtfyTransport, type SignalingTransport } from './signaling';
import { Tabs, type TabsOptions } from './tabs';
import type { RelayRefusal } from './relay-refusal';
import { probeRelay, type RelayDiagnosis } from './relay-status';
import { fetchRelayStats, type RelayStats } from './relay-stats';
import { RelayLink, type RelayLinkEvents } from './relay-link';
import { defaultSignalingUrl, isRelayUrl, NTFY_SIGNALING_URL } from './transport-factory';

/** How often a broken relay is asked for its status. */
const PROBE_INTERVAL_MS = 2 * 60_000;
/** How long to open no sockets after the relay refused this network for its connection rate (the limit counts per minute). */
const REFUSED_PAUSE_MS = 90_000;

export interface StoredPairing {
  secret: string;
  signalingUrl: string;
  /**
   * 2 once the signaling server was chosen under the relay default. A pairing without it that
   * names ntfy.sh got it as the old default and moves to the relay (every device updates alike).
   */
  signalingVersion?: number;
  /** Devices met with this secret, so this device can offer to them straight away. */
  peers?: string[];
  /** Older single-peer format; read and folded into `peers`. */
  peerId?: string;
  /**
   * The first layout of per-pair space choices (one list per peer). Read once to fill the account
   * document's `keeps` map (`legacyPeerChoices`), then removed.
   */
  peerSpaces?: Record<string, string[]>;
  /** The account this pairing belongs to. Unset while a joining device waits to learn it. */
  accountId?: string;
}

export interface SyncStatus {
  paired: boolean;
  /** Connected when any device is connected. */
  state: LinkState;
  lastConnectedAt?: number;
  /** Every device paired with the same secret, with its own state. */
  peers: PeerInfo[];
  signalingUrl: string;
  /** Set while the signaling server is rate-limiting this network: when publishing resumes. */
  signalingPausedUntil?: number;
  /** The signaling server has been unreachable for several seconds. */
  signalingProblem: boolean;
  /** The relay refused data lately; direct sync still works. */
  relayLimit?: 'day' | 'rate' | 'service';
  /** The relay named a limit when this network connected (a close code, relay-refusal.ts); set while the pause lasts. */
  relayRefusal?: RelayRefusal;
  /** While the relay misbehaves: whose limit it is (ours, Cloudflare's, the network's). See relay-status.ts. */
  relayDiagnosis?: RelayDiagnosis;
  /** Another tab of this browser runs sync; this status is that tab's. */
  otherTab?: boolean;
}

export interface SyncServiceOptions {
  deviceId: string;
  /** Picks a transport for a signaling server URL. Default: ntfy for every URL. */
  createTransport?: (url: string, kind?: RoomKind) => SignalingTransport;
  /** What this service's relay room is for (#109): the account (default) or a shared space. */
  roomKind?: 'a' | 's';
  storageKey?: string;
  /** Safety timer while disconnected and visible (ms). */
  safetyTimerMs?: number;
  /** Devices the owner removed (any of their devices); never connected to. */
  isBlocked?(peerId: string): boolean;
  /** Whether a document may sync with this peer: the account document, and the spaces both devices keep. */
  allowDoc?(docId: string, peerId: string): boolean;
  /** A peer sent a frame for a document that may sync with it. */
  onDocReceived?(docId: string, peerId: string): void;
  /** Ask for the camera before pairing so Chrome shows real LAN addresses. Default true; an Obsidian plugin has no use for it. */
  realAddresses?: boolean;
  /** This device's account, recorded with a new pairing. */
  accountId?(): string;
  /** A pairing was started or joined on this device (it is in an account again). */
  onPairingStarted?(): void;
  /** This device's and its peers' certified keys, for the signed handshake and pair keys (#256). */
  identity?: SyncIdentity;
  /** Files in notes (#166): what to fetch and who may be sent what. Absent: no file transfer. */
  files?: FileHost;
  /** Overrides for the tab coordination (tests). */
  tabs?: Partial<Pick<TabsOptions, 'locks' | 'createChannel' | 'pingTimeoutMs'>>;
}

/** A pairing stored on ntfy.sh before the relay became the default moves to the relay; any other choice is kept. */
export function migratePairing(stored: StoredPairing, defaultUrl: string): StoredPairing {
  if (stored.signalingVersion !== undefined) return stored;
  const onOldDefault = stored.signalingUrl.trim().replace(/\/+$/, '') === NTFY_SIGNALING_URL;
  return { ...stored, signalingVersion: 2, ...(onOldDefault ? { signalingUrl: defaultUrl } : {}) };
}

/**
 * Owns this device's pairing and keeps every open document in sync with the paired device:
 * pairing by short secret, the link manager, the document multiplexer and the event-driven
 * reconnect triggers described in docs/sync.md.
 */
export class SyncService {
  readonly log = new EventLog();
  private mesh: PeerMesh | undefined;
  /** One document multiplexer per connected device; devices relay edits to each other. */
  private readonly muxes = new Map<string, DocMux>();
  private readonly senders = new Map<string, (frame: Uint8Array) => void>();
  private readonly pending = new Map<string, Uint8Array[]>();
  /** File transfer between devices; direct links only (file-transfer.ts). */
  private files: FileTransfer | undefined;
  private pairing: StoredPairing | undefined;
  private lastConnectedAt: number | undefined;
  private readonly listeners = new Set<(s: SyncStatus) => void>();
  private statusForTest: SyncStatus | undefined;
  private triggerTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly storageKey: string;
  private readonly createTransport: (url: string, kind?: RoomKind) => SignalingTransport;
  private started = false;
  /** One tab per browser runs the mesh; the others sync with it (`tabs.ts`). */
  private tabs: Tabs | undefined;
  private leaderStatus: SyncStatus | undefined;

  constructor(
    private readonly store: DocumentStore,
    private readonly options: SyncServiceOptions,
  ) {
    this.storageKey = options.storageKey ?? `${STORAGE_PREFIX}-app-pairing`;
    this.createTransport = options.createTransport ?? ((url) => new NtfyTransport({ baseUrl: url }));
  }

  /** Install triggers and resume a stored pairing. Call once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    watchEnvironment(this.log);
    this.installTriggers();
    this.pairing = this.load();
    const tabs = new Tabs({
      ...this.options.tabs,
      store: this.store,
      name: this.storageKey,
      log: (text) => this.log.log('tabs', text),
      onLead: () => this.resume(),
      onFollow: () => this.suspend(),
      onLeaderStatus: (status) => {
        this.leaderStatus = status as SyncStatus;
        this.pairing = this.load();
        this.emit();
      },
      status: () => this.status,
    });
    this.tabs = tabs;
    tabs.start();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tabs.ping();
    });
    window.addEventListener('pagehide', (e) => {
      if (!e.persisted) tabs.close();
    });
  }

  /** This tab now runs sync for the browser: resume the stored pairing. */
  private resume(): void {
    this.leaderStatus = undefined;
    const stored = this.load();
    if (stored) {
      this.log.log('pairing', 'resuming stored pairing');
      void this.run(stored);
    } else {
      this.pairing = undefined;
      this.emit();
    }
  }

  /** Another tab took over: stop this tab's links; its documents now sync through that tab. */
  private suspend(): void {
    this.mesh?.stop();
    this.mesh = undefined;
    this.detachAll();
    this.pairing = this.load();
    this.emit();
  }

  /** True while another tab runs sync. Acting on sync here first makes this tab the one that does. */
  private get following(): boolean {
    return this.tabs !== undefined && !this.tabs.isLeader;
  }

  private async lead(): Promise<void> {
    if (this.following) await this.tabs?.takeOver();
  }

  get status(): SyncStatus {
    if (this.statusForTest) return this.statusForTest;
    if (this.following) {
      const l = this.leaderStatus;
      return {
        paired: this.pairing !== undefined,
        state: l?.state ?? 'stopped',
        ...(l?.lastConnectedAt !== undefined ? { lastConnectedAt: l.lastConnectedAt } : {}),
        peers: l?.peers ?? [],
        signalingUrl: this.pairing?.signalingUrl ?? defaultSignalingUrl(),
        ...(l?.signalingPausedUntil !== undefined ? { signalingPausedUntil: l.signalingPausedUntil } : {}),
        signalingProblem: l?.signalingProblem ?? false,
        ...(l?.relayLimit ? { relayLimit: l.relayLimit } : {}),
        ...(l?.relayRefusal ? { relayRefusal: l.relayRefusal } : {}),
        ...(l?.relayDiagnosis ? { relayDiagnosis: l.relayDiagnosis } : {}),
        otherTab: true,
      };
    }
    return {
      paired: this.pairing !== undefined,
      state: this.mesh?.state ?? 'stopped',
      ...(this.lastConnectedAt !== undefined ? { lastConnectedAt: this.lastConnectedAt } : {}),
      peers: this.mesh?.peers ?? [],
      signalingUrl: this.pairing?.signalingUrl ?? defaultSignalingUrl(),
      ...(this.mesh?.signalingPausedUntil !== undefined ? { signalingPausedUntil: this.mesh.signalingPausedUntil } : {}),
      signalingProblem: this.mesh?.signalingProblem ?? false,
      ...(this.mesh?.relayLimit ? { relayLimit: this.mesh.relayLimit } : {}),
      ...(this.mesh?.relayRefusal ? { relayRefusal: this.mesh.relayRefusal } : {}),
      ...(this.diagnosis ? { relayDiagnosis: this.diagnosis } : {}),
    };
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Create a fresh secret, start pairing, and return the secret to show the person. */
  /** What this account's relay room has carried; undefined when not paired or the server is not our relay. */
  async relayStats(): Promise<RelayStats | undefined> {
    const pairing = this.pairing;
    if (!pairing) return undefined;
    return fetchRelayStats(pairing.signalingUrl, (await deriveKeys(pairing.secret)).topic);
  }

  async startNewPairing(signalingUrl = defaultSignalingUrl()): Promise<string> {
    await this.lead();
    const secret = generateSecret();
    await this.begin(secret, signalingUrl, this.options.accountId?.());
    return secret;
  }

  /** Join a pairing started on another device. Throws on a mistyped secret. */
  async join(secret: string, signalingUrl = defaultSignalingUrl()): Promise<void> {
    normalizeSecret(secret);
    await this.lead();
    await this.begin(secret, signalingUrl);
  }

  /** An enrolled device approved this one (one-time invite, #257): move to the account's own sync secret and account. */
  async adoptPairing(secret: string, signalingUrl: string, accountId: string): Promise<void> {
    await this.lead();
    await this.begin(secret, signalingUrl, accountId);
  }

  /** Stop syncing and forget the secret on this device. */
  unpair(): void {
    if (this.following) {
      void this.lead().then(() => this.unpair());
      return;
    }
    this.mesh?.stop();
    this.mesh = undefined;
    this.detachAll();
    this.pairing = undefined;
    this.lastConnectedAt = undefined;
    this.save(undefined);
    this.log.log('pairing', 'unpaired; stored secret removed from this device');
    this.emit();
  }

  /** The Reconnect button. */
  reconnect(): void {
    if (this.following) void this.lead();
    this.mesh?.reconnect('reconnect button', { force: true });
    // Also re-evaluate which documents each linked device may sync, in case the filter changed since the link came up.
    this.refilter();
  }

  /** Stop syncing with one device, for example a browser that was reset and came back with a new id. */
  forget(peerId: string): void {
    this.mesh?.forget(peerId);
    this.detach(peerId);
    if (this.pairing) {
      this.pairing = { ...this.pairing, peers: (this.pairing.peers ?? []).filter((p) => p !== peerId) };
      this.save(this.pairing);
    }
    this.emit();
  }

  /** The pairing code this device uses, to add another device with the same code. */
  get secret(): string | undefined {
    return this.pairing?.secret;
  }

  /** The stored pairing's secret, read before `start()` (the account id of a first-layout pairing derives from it). */
  storedSecret(): string | undefined {
    return this.load()?.secret;
  }

  /** The account the pairing belongs to; undefined while a device that joined waits to learn it. */
  get pairedAccountId(): string | undefined {
    return this.pairing?.accountId;
  }

  /** Record the account this pairing belongs to (after joining, or for a pairing from the first layout). */
  setAccount(accountId: string): void {
    if (!this.pairing || this.pairing.accountId === accountId) return;
    this.pairing = { ...this.pairing, accountId };
    this.save(this.pairing);
    this.log.log('pairing', `account ${accountId.slice(0, 8)}`);
    this.emit();
  }

  /** Devices met with this pairing, for the one-time move of per-pair space choices into `keeps`. */
  knownPeers(): string[] {
    return this.load()?.peers ?? [];
  }

  /** The per-pair space choices of the first layout (one list per peer), if any are stored. */
  legacyPeerSpaces(): Record<string, string[]> | undefined {
    return this.load()?.peerSpaces;
  }

  /** Drop the per-pair choices after they were moved. */
  clearLegacyPeerChoices(): void {
    const stored = this.load();
    if (!stored?.peerSpaces) return;
    const { peerSpaces: _moved, ...rest } = stored;
    this.save(rest);
    if (this.pairing) {
      const { peerSpaces: _also, ...current } = this.pairing;
      this.pairing = current;
    }
  }

  /**
   * The spaces a device keeps changed: apply the new filter to every open link now. Documents no
   * longer allowed stop syncing; newly allowed ones start. Nothing already synced is removed.
   */
  refilter(): void {
    for (const [peerId, send] of this.senders) this.attach(peerId, send);
  }

  /**
   * Change the sync code for the whole account. Devices linked now receive the new code over their
   * encrypted link and switch by themselves; a device that is off (or removed) keeps the old code and
   * needs the new one entered once. Returns the new code and how many devices were reached.
   */
  async changeCode(): Promise<{ secret: string; reached: number; total: number }> {
    await this.lead();
    if (!this.pairing) throw new Error('This device is not syncing.');
    const secret = generateSecret();
    const frame = encodeControl({ kind: 'sync-code', secret, account: this.pairing.accountId ?? '' });
    const reached = [...this.senders.keys()];
    const total = (this.mesh?.peers ?? []).filter((p) => !this.options.isBlocked?.(p.id)).length;
    for (const id of reached) this.senders.get(id)?.(frame);
    this.log.log('pairing', `new sync code sent to ${reached.length} linked device(s)`);
    // Let the message leave before the links are closed.
    await new Promise((r) => setTimeout(r, 700));
    await this.switchCode(secret);
    // Out of the devices listed now (linked or waiting, not removed), not every device ever met.
    return { secret, reached: reached.length, total: Math.max(reached.length, total) };
  }

  private async switchCode(secret: string): Promise<void> {
    if (!this.pairing) return;
    const next: StoredPairing = { ...this.pairing, secret: normalizeSecret(secret) };
    this.save(next);
    await this.run(next);
  }

  /** A linked device tells this one to move to a new sync code (see `changeCode`). */
  private onControl(peerId: string, message: Record<string, unknown>): void {
    if (message.kind !== 'sync-code' || typeof message.secret !== 'string' || !this.pairing) return;
    // With keys required the sync secret does not change (S-258b, S-295).
    if (this.options.identity?.required()) return;
    // Only a device of this pairing that is not removed, in the same account, may do this.
    if (!(this.pairing.peers ?? []).includes(peerId) || this.options.isBlocked?.(peerId)) return;
    if (this.pairing.accountId && message.account !== this.pairing.accountId) return;
    let secret: string;
    try {
      secret = normalizeSecret(message.secret);
    } catch {
      return;
    }
    if (secret === this.pairing.secret) return;
    this.log.log('pairing', `${peerId.slice(0, 8)}: moving to the new sync code`);
    void this.switchCode(secret);
  }

  /** Connect to a device again after it was removed and then allowed. */
  allow(peerId: string): void {
    if (!this.pairing) return;
    if (!(this.pairing.peers ?? []).includes(peerId)) {
      this.pairing = { ...this.pairing, peers: [...(this.pairing.peers ?? []), peerId] };
      this.save(this.pairing);
    }
    this.mesh?.addPeer(peerId);
  }

  /**
   * How many changes in `docIds` exist only on this device, judged by what each linked device last
   * announced; with several, the smallest count (a change any of them has is safe). `unknown` lists
   * the documents no linked device announced yet, so nothing can be said about them.
   */
  onlyHere(docIds: readonly string[]): { count: number; unknown: string[] } {
    const gaps = [...this.muxes.values()].map((m) => m.missingOnPeer());
    let count = 0;
    const unknown: string[] = [];
    for (const id of docIds) {
      const seen = gaps.map((g) => g.get(id)).filter((n): n is number => n !== undefined);
      if (seen.length === 0) unknown.push(id);
      else count += Math.min(...seen);
    }
    return { count, unknown };
  }

  /** Plain-text report for troubleshooting: state and connection log, no secrets or addresses. */
  report(): string {
    const s = this.status;
    return [
      `device ${this.options.deviceId.slice(0, 8)}`,
      `paired ${s.paired}`,
      `link ${s.state}`,
      ...s.peers.map((p) => `peer ${p.id.slice(0, 8)} ${p.state}`),
      `documents ${[...this.store.opened().keys()].join(', ')}`,
      '',
      this.log.toText(),
    ].join('\n');
  }

  /** The link to this peer is proven by its device key (signed handshake or pair-key relay). */
  isVerified(peerId: string): boolean {
    return this.mesh?.isVerified(peerId) ?? false;
  }

  /** Certificates or the keys-required mark changed: work out pair keys again and re-apply the filter. */
  keysChanged(): void {
    void this.mesh?.refreshKeys().then(() => this.refilter());
  }

  /** Test hook: drop the link as if the network failed. */
  dropForTest(peerId?: string): void {
    this.mesh?.dropForTest(peerId);
  }

  /** Test hook: report this status instead of the real one (undefined goes back), to show the header's sync shapes without real devices. */
  setStatusForTest(s: SyncStatus | undefined): void {
    this.statusForTest = s;
    this.emit();
  }

  private async begin(secret: string, signalingUrl: string, accountId?: string): Promise<void> {
    const normalized = normalizeSecret(secret);
    const url = signalingUrl.trim() || defaultSignalingUrl();
    if (this.options.realAddresses !== false) await ensureRealAddresses(this.log);
    const pairing: StoredPairing = { secret: normalized, signalingUrl: url, signalingVersion: 2, ...(accountId ? { accountId } : {}) };
    this.save(pairing);
    this.options.onPairingStarted?.();
    await this.run(pairing);
  }

  private async run(pairing: StoredPairing): Promise<void> {
    this.mesh?.stop();
    this.detachAll();
    const known = [...new Set([...(pairing.peers ?? []), ...(pairing.peerId ? [pairing.peerId] : [])])];
    this.pairing = {
      secret: pairing.secret,
      signalingUrl: pairing.signalingUrl,
      signalingVersion: 2,
      peers: known,
      ...(pairing.peerSpaces ? { peerSpaces: pairing.peerSpaces } : {}),
      ...(pairing.accountId ? { accountId: pairing.accountId } : {}),
    };
    const keys = await deriveKeys(pairing.secret);
    const mesh = new PeerMesh({
      selfId: this.options.deviceId,
      knownPeers: known,
      topic: keys.topic,
      key: keys.key,
      transport: this.createTransport(pairing.signalingUrl, this.options.roomKind ?? 'a'),
      createLink: (events) => new PeerLink(events, this.log, toIceServers(loadIceUrls())),
      ...(isRelayUrl(pairing.signalingUrl)
        ? {
            createRelay: (peerId: string, events: RelayLinkEvents, pair?: { key: CryptoKey; only: boolean }) =>
              new RelayLink({ baseUrl: pairing.signalingUrl, kind: this.options.roomKind ?? 'a', topic: keys.topic, selfId: this.options.deviceId, peerId, key: keys.key, ...(pair ? { pair } : {}), log: this.log }, events),
          }
        : {}),
      ...(this.options.isBlocked ? { isBlocked: this.options.isBlocked } : {}),
      ...(this.options.identity ? { identity: this.options.identity } : {}),
      log: this.log,
      onPeersChanged: (peers) => {
        const ids = peers.map((p) => p.id);
        if (this.pairing && ids.some((id) => !(this.pairing?.peers ?? []).includes(id))) {
          this.pairing = { ...this.pairing, peers: [...new Set([...(this.pairing.peers ?? []), ...ids])] };
          this.save(this.pairing);
        }
        const pausedUntil = mesh.signalingPausedUntil;
        if (pausedUntil !== undefined) setTimeout(() => this.emit(), pausedUntil - Date.now() + 100);
        this.emit();
      },
      onLinkOpen: (peerId) => {
        this.lastConnectedAt = Date.now();
        this.attach(peerId, (frame) => mesh.send(peerId, frame));
      },
      onDirectChange: (peerId, direct) => {
        if (direct) this.files?.peerDirect(peerId, (frame) => void mesh.sendDirect(peerId, frame));
        else this.files?.peerGone(peerId);
      },
      onLinkData: (peerId, data, via) => this.onLinkData(peerId, data, via),
      onLinkClose: (peerId) => this.detach(peerId),
    });
    this.mesh = mesh;
    if (this.options.files) {
      this.files = new FileTransfer(this.options.files);
      this.files.start();
    }
    mesh.start();
    this.emit();
  }

  /** Data from a peer. File frames count only from a direct link: the relay carries text only, even while a direct link is open too. */
  private onLinkData(peerId: string, data: Uint8Array, via: 'direct' | 'relay'): void {
    if (data[0] === FRAME_FILE_PIECE) {
      if (via === 'direct') this.files?.onPiece(peerId, data);
      return;
    }
    const control = decodeControl(data);
    if (control) {
      if (typeof control.kind === 'string' && control.kind.startsWith('file-')) {
        if (via === 'direct') this.files?.onControl(peerId, control);
        return;
      }
      this.onControl(peerId, control);
      return;
    }
    const mux = this.muxes.get(peerId);
    if (mux) mux.receive(data);
    else this.pending.set(peerId, [...(this.pending.get(peerId) ?? []), data]);
  }

  private allows(peerId: string, docId: string): boolean {
    if (!isValidDocId(docId)) return false;
    if (this.options.allowDoc) return this.options.allowDoc(docId, peerId);
    return docId.startsWith('account/') || (docId.startsWith('space/') && spaceOfDoc(docId) !== undefined);
  }

  private attach(peerId: string, send: (frame: Uint8Array) => void): void {
    this.muxes.get(peerId)?.close();
    this.senders.set(peerId, send);
    const mux = new DocMux(this.store, send, {
      allowDoc: (docId) => this.allows(peerId, docId),
      onReceived: (docId) => this.options.onDocReceived?.(docId, peerId),
      onAttach: (docId) => {
        const space = spaceOfDoc(docId);
        if (space && !isLogDoc(docId)) this.log.log('space', `${peerId.slice(0, 8)}: syncing ${docId.endsWith('/private') ? 'private part' : 'space'}`, space);
      },
      onError: (e) => this.log.log('sync', `${peerId.slice(0, 8)}: ignored: ${e instanceof Error ? e.message : String(e)}`),
    });
    this.muxes.set(peerId, mux);
    mux.start();
    this.log.log('sync', `${peerId.slice(0, 8)}: attached`);
    for (const frame of this.pending.get(peerId) ?? []) mux.receive(frame);
    this.pending.delete(peerId);
  }

  private detach(peerId: string): void {
    const mux = this.muxes.get(peerId);
    if (mux) this.log.log('sync', `${peerId.slice(0, 8)}: detached`);
    mux?.close();
    this.muxes.delete(peerId);
    this.senders.delete(peerId);
    this.pending.delete(peerId);
  }

  private detachAll(): void {
    this.files?.close();
    this.files = undefined;
    for (const id of [...this.muxes.keys()]) this.detach(id);
    this.pending.clear();
  }

  private diagnosis: RelayDiagnosis | undefined;
  private lastProbeAt = 0;

  /**
   * While the relay seems broken (signaling down, or a link told us a limit), ask it why, at most
   * every two minutes. One plain request: it is how a limit of ours is told from Cloudflare's.
   */
  private watchRelay(): void {
    if (this.following || !this.pairing) return;
    // A close code already said whose limit it is; the probe is for failures that carried no reason.
    const broken = ((this.mesh?.signalingProblem ?? false) || this.mesh?.relayLimit !== undefined) && this.mesh?.relayRefusal === undefined;
    if (!broken) {
      if (this.diagnosis) {
        this.diagnosis = undefined;
        this.emit();
      }
      return;
    }
    if (Date.now() - this.lastProbeAt < PROBE_INTERVAL_MS) return;
    this.lastProbeAt = Date.now();
    const url = this.pairing.signalingUrl;
    void probeRelay(url).then((d) => {
      if (!d || this.pairing?.signalingUrl !== url) return;
      this.log.log('relay', `status: ${d.kind}${d.kind === 'ours-limited' ? ` (${d.scope})` : ''}`);
      this.diagnosis = d;
      // The status call itself was turned away (an older relay refuses with HTTP 429, no close code):
      // retrying at once keeps this network over the limit. A plain drop gets the normal backoff.
      if (d.kind === 'ours-refused' && d.originAllowed !== false) this.mesh?.pauseConnections(d.retryAfterMs ?? REFUSED_PAUSE_MS);
      this.emit();
    });
  }

  private emit(): void {
    this.watchRelay();
    const s = this.status;
    if (!this.following && !this.statusForTest) this.tabs?.publishStatus(s);
    for (const l of this.listeners) l(s);
  }

  private trigger(reason: string, options: { force?: boolean; streamLikelyDead?: boolean; wake?: boolean } = {}): void {
    clearTimeout(this.triggerTimer);
    this.triggerTimer = setTimeout(() => this.mesh?.reconnect(reason, options), 500);
  }

  private installTriggers(): void {
    window.addEventListener('online', () => this.trigger('online', { force: true, streamLikelyDead: true }));
    // Wi-Fi to mobile data, a VPN coming up: a direct path may exist now (#110). Chromium-based browsers only.
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    connection?.addEventListener?.('change', () => this.trigger('network change', { force: true, streamLikelyDead: true }));
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) this.trigger('restored', { force: true, streamLikelyDead: true });
    });
    document.addEventListener('resume', () => this.trigger('resume', { force: true, streamLikelyDead: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.trigger('visible', { wake: true });
    });
    window.addEventListener('focus', () => this.trigger('focus'));
    setInterval(() => {
      if (document.visibilityState === 'visible' && this.mesh && this.mesh.peers.some((p) => p.state !== 'connected')) {
        this.mesh.reconnect('safety timer');
      }
    }, this.options.safetyTimerMs ?? 3 * 60_000);
    // A local edit while disconnected is a reason to try again (rate-limited and backed off by the mesh).
    const watch = (doc: import('yjs').Doc): void => {
      doc.on('update', (_u: Uint8Array, origin: unknown) => {
        if (!(origin instanceof DocSync) && this.mesh && this.mesh.peers.some((p) => p.state !== 'connected')) {
          this.trigger('local edit');
        }
      });
    };
    for (const doc of this.store.opened().values()) watch(doc);
    this.store.onOpened((_id, doc) => watch(doc));
  }

  private load(): StoredPairing | undefined {
    let stored: StoredPairing | undefined;
    try {
      const raw = localStorage.getItem(this.storageKey);
      stored = raw ? (JSON.parse(raw) as StoredPairing) : undefined;
    } catch {
      return undefined;
    }
    return stored ? this.migrate(stored) : undefined;
  }

  private migrate(stored: StoredPairing): StoredPairing {
    if (stored.signalingVersion !== undefined) return stored;
    const next = migratePairing(stored, defaultSignalingUrl());
    if (next.signalingUrl !== stored.signalingUrl) {
      this.log.log('pairing', "moved from ntfy.sh to this site's relay, the new default signaling server");
    }
    this.save(next);
    return next;
  }

  private save(value: StoredPairing | undefined): void {
    // The tab that syncs owns the stored pairing; another tab's copy may be stale.
    if (this.following) return;
    try {
      if (value) localStorage.setItem(this.storageKey, JSON.stringify(value));
      else localStorage.removeItem(this.storageKey);
    } catch {
      // Storage unavailable: the pairing lasts until the page closes.
    }
  }
}
