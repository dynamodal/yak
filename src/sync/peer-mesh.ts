import type { EventLog } from './event-log';
import { open, ReplayGuard, seal, type Opened, type SignalPayload, type SignalType } from './envelope';
import { derivePairKey, peerTag, signSignal, verifySignal, type SyncIdentity } from './handshake';
import type { LinkEndpoint, LinkState } from './types';
import type { PeerLinkEvents } from './peer-link';
import type { RelayLinkEvents } from './relay-link';
import { RateLimitedError, type InboxMessage, type SignalingTransport } from './signaling';

export interface PeerInfo {
  id: string;
  state: LinkState;
  lastConnectedAt?: number;
  lastSeenAt?: number;
  /** While connected: the path the data takes. */
  via?: 'direct' | 'relay';
  /** The pair key with this device failed this session; it syncs with the shared key (S-256c). */
  sharedKey?: boolean;
}

/** The relay data path to one peer (`RelayLink` implements it). */
export interface RelayEndpoint {
  start(): void;
  send(data: Uint8Array): void;
  close(): void;
}

export interface PeerMeshOptions {
  selfId: string;
  /** Peers known from earlier sessions; they are offered to straight away when this device initiates. */
  knownPeers?: string[];
  topic: string;
  key: CryptoKey;
  transport: SignalingTransport;
  createLink(events: PeerLinkEvents): LinkEndpoint;
  log: EventLog;
  /** Any peer appeared or changed state. */
  onPeersChanged(peers: PeerInfo[]): void;
  onLinkOpen(peerId: string): void;
  /** `via` is the path the data came in on; file frames are only honoured from `direct` (the relay carries text only). */
  onLinkData(peerId: string, data: Uint8Array, via: 'direct' | 'relay'): void;
  /** The direct (peer-to-peer) path to a peer opened or closed; the relay path does not count. File transfer uses direct paths only. */
  onDirectChange?(peerId: string, direct: boolean): void;
  /** A link that was open dropped. Not called for attempts that never connected. */
  onLinkClose(peerId: string, reason: string): void;
  randomId?(): string;
  /** Re-offers after an unanswered offer, as insurance against a lost message; then it waits. */
  retryDelaysMs?: number[];
  /** A signaling stream with no traffic for this long is presumed dead. */
  staleStreamMs?: number;
  /** Offers older than this on the server's clock are replays from its cache and are ignored. */
  maxOfferAgeMs?: number;
  /** Messages older than this on the server's clock are dropped. */
  maxMessageAgeMs?: number;
  /** Automatic reconnect triggers are acted on at most this often; wake-ups (page shown) use this interval. */
  minTriggerIntervalMs?: number;
  /** Background triggers (focus, edits, timers) back off from the minimum to this while nobody answers. */
  maxTriggerIntervalMs?: number;
  /** After the signaling server answers 429, publish nothing for at least this long. */
  rateLimitPauseMs?: number;
  /** At most this many peers; further devices holding the key are ignored. */
  maxPeers?: number;
  /** Devices the owner removed: their messages are ignored. */
  isBlocked?(peerId: string): boolean;
  /**
   * Opens the data path through the relay to one peer. Absent: direct links only. `pair` is the pair
   * key of two certified devices; with `only` (keys required) frames sealed with the shared key are refused.
   */
  createRelay?(peerId: string, events: RelayLinkEvents, pair?: { key: CryptoKey; only: boolean }): RelayEndpoint;
  /** This device's and its peers' certified keys (#256). Absent: no signatures, as before. */
  identity?: SyncIdentity;
  /** No direct link this long after an offer or answer: use the relay too. Default 5 s. */
  relayAfterMs?: number;
  /** While on the relay, the initiator offers again this often to find a direct path. Default 60 s. */
  directRetryMs?: number;
  /** A relay socket with no peer on it this long is closed. Default 10 min. */
  relayIdleMs?: number;
}

/** The signaling stream must stay down this long before it counts as a problem. */
const PROBLEM_AFTER_MS = 8000;
/** How long a fresh offer is left alone before another trigger may replace it. */
const ATTEMPT_GRACE_MS = 3000;
/** A device replies to one peer's hello at most this often. */
const HELLO_REPLY_INTERVAL_MS = 5000;
/** An offer sealed with the pair key counts as unanswered once the peer talks this long after it without answering. */
const PAIR_ANSWER_MS = 1000;
/** After a direct link opens while on the relay: how long the relay stays for the other device to catch up. */
const RELAY_HANDOVER_MS = 3000;

/**
 * One device's links to every other device paired with the same secret, over one push mailbox.
 *
 * Each pair of devices has its own session with the rules of the single-peer manager: the lower
 * device id offers, an offer and its answer are addressed to one device (`to`), and the session
 * reconnects on its own after a drop. Hellos are broadcast. Data never goes through the mailbox;
 * each open link carries the document sync, and devices relay edits to each other.
 */
export class PeerMesh {
  private readonly sessions = new Map<string, Session>();
  private started = false;
  private unsubscribe: (() => void) | undefined;
  private lastMessageId: string | undefined;
  private signalUp = false;
  private lastSignalActivity = 0;
  private serverSkewMs = 0;
  private lastTriggerAt = 0;
  private pausedUntil = 0;
  private pauseLogged = false;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  /** When the signaling stream last went down (0 while it is up); see `signalingProblem`. */
  private signalDownSince = 0;
  private problemTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly guard: ReplayGuard;
  private unreadableHelloAt = 0;
  readonly retryDelays: number[];
  private readonly staleStreamMs: number;
  readonly maxOfferAge: number;
  private readonly minTriggerInterval: number;
  private readonly maxTriggerInterval: number;
  private triggerInterval: number;
  private readonly rateLimitPause: number;
  private readonly maxPeers: number;

  constructor(readonly opts: PeerMeshOptions) {
    this.retryDelays = opts.retryDelaysMs ?? [15_000, 60_000];
    this.staleStreamMs = opts.staleStreamMs ?? 100_000;
    this.maxOfferAge = opts.maxOfferAgeMs ?? 60_000;
    this.minTriggerInterval = opts.minTriggerIntervalMs ?? 20_000;
    this.maxTriggerInterval = opts.maxTriggerIntervalMs ?? 15 * 60_000;
    this.triggerInterval = this.minTriggerInterval;
    this.rateLimitPause = opts.rateLimitPauseMs ?? 60_000;
    this.maxPeers = opts.maxPeers ?? 8;
    this.guard = new ReplayGuard(opts.maxMessageAgeMs ?? 5 * 60_000);
    for (const id of opts.knownPeers ?? []) {
      if (id !== opts.selfId && !opts.isBlocked?.(id) && this.sessions.size < this.maxPeers) this.sessions.set(id, new Session(id, this));
    }
  }

  /** The relay refused data lately (its daily budget or its pace); direct links are unaffected. Cleared when a relay link opens. */
  relayLimit: 'day' | 'rate' | 'service' | undefined;

  noteRelayLimit(reason: 'day' | 'rate' | 'service' | undefined): void {
    if (this.relayLimit === reason) return;
    this.relayLimit = reason;
    if (reason) this.opts.log.log('link', `relay limit reached (${reason}); direct sync still works`);
    this.changed();
  }

  get isStarted(): boolean {
    return this.started;
  }

  get selfId(): string {
    return this.opts.selfId;
  }

  get peers(): PeerInfo[] {
    return [...this.sessions.values()].map((s) => s.info());
  }

  /** One state for the whole device: connected when any peer is connected. */
  get state(): LinkState {
    if (!this.started) return 'stopped';
    const states = [...this.sessions.values()].map((s) => s.state);
    if (states.includes('connected')) return 'connected';
    if (states.includes('connecting')) return 'connecting';
    if (states.includes('reconnecting')) return 'reconnecting';
    return 'waiting-for-peer';
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.markSignalDown();
    this.subscribe();
    void this.say('hello');
    for (const s of this.sessions.values()) if (s.isInitiator) void s.attempt('start');
    this.changed();
  }

  stop(): void {
    this.started = false;
    clearTimeout(this.problemTimer);
    clearTimeout(this.resumeTimer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const s of this.sessions.values()) s.close();
    this.changed();
  }

  /** Start talking to a device again (one that was removed and is now allowed): offer, or ask it to. */
  addPeer(peerId: string): void {
    if (!this.started || peerId === this.opts.selfId || this.sessions.has(peerId) || this.opts.isBlocked?.(peerId)) return;
    if (this.sessions.size >= this.maxPeers) return;
    const s = new Session(peerId, this);
    this.sessions.set(peerId, s);
    this.changed();
    if (s.isInitiator) void s.attempt('allowed again');
    else void this.say('hello', { to: peerId });
  }

  /** Stop talking to a device (for example one whose browser was reset and came back with a new id). */
  forget(peerId: string): void {
    const s = this.sessions.get(peerId);
    if (!s) return;
    s.close();
    this.sessions.delete(peerId);
    this.changed();
  }

  /**
   * The signaling server could not be reached for several seconds (the network itself may be fine).
   * Short drops, such as a stream being restarted, are not reported.
   */
  get signalingProblem(): boolean {
    return this.started && !this.signalUp && this.signalDownSince > 0 && Date.now() - this.signalDownSince >= PROBLEM_AFTER_MS;
  }

  /** While the signaling server is rate-limiting this network: when publishing resumes. */
  get signalingPausedUntil(): number | undefined {
    return this.pausedUntil > Date.now() ? this.pausedUntil : undefined;
  }

  /**
   * The relay is turning this network away (too many connections in a minute). Every attempt counts
   * against the limit, so open no sockets for `ms`: the signaling stream and relay sockets that are
   * not carrying a link close, and nothing reconnects until the pause is over. Open links stay.
   */
  pauseConnections(ms: number): void {
    if (!this.started) return;
    const until = Date.now() + ms;
    if (until <= this.pausedUntil) return;
    this.pausedUntil = until;
    this.pauseLogged = false;
    this.opts.log.log('signal', `the relay is refusing this network; no new connections for ${Math.round(ms / 1000)} s`);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const s of this.sessions.values()) s.pauseRelay();
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => this.reconnect('pause over', { force: true }), ms + 100);
    this.changed();
  }

  /**
   * Something suggests links could be (re)established now. The signaling stream is restarted only
   * when it is likely dead.
   *
   * `force` (the Reconnect button, coming back online, waking from sleep) makes fresh offers at once.
   * Automatic triggers cost one broadcast hello at most and never replace an offer that is still
   * waiting for its answer: a device that hears the hello replies, and the lower id then offers.
   * They are rate-limited: `wake` triggers (the page was shown) to the minimum interval, background
   * triggers (focus, edits, timers) to an interval that doubles while nobody answers, so a device
   * whose peers are switched off stays nearly silent.
   */
  reconnect(reason: string, options: { force?: boolean; streamLikelyDead?: boolean; wake?: boolean } = {}): void {
    if (!this.started) return;
    if (this.signalingPausedUntil !== undefined) {
      this.opts.log.log('link', `${reason}: skipped while paused`);
      return;
    }
    const now = Date.now();
    const stale = now - this.lastSignalActivity > this.staleStreamMs;
    if (options.streamLikelyDead === true || options.force === true || !this.signalUp || stale) {
      this.opts.log.log('link', `${reason}: restarting signaling stream`);
      this.unsubscribe?.();
      this.subscribe();
    }
    const waiting = [...this.sessions.values()].filter((s) => !s.linkOpen);
    if (this.sessions.size > 0 && waiting.length === 0) return;

    if (options.force === true) {
      this.lastTriggerAt = now;
      this.triggerInterval = this.minTriggerInterval;
      this.opts.log.log('link', `reconnect: ${reason}`);
      for (const s of waiting) {
        s.resetRetries();
        s.refreshRelay();
        if (s.isInitiator) void s.attempt(reason, true);
      }
      // Responders (and a device that knows no peer yet) announce themselves once.
      if (this.sessions.size === 0 || waiting.some((s) => !s.isInitiator)) void this.say('hello');
      return;
    }

    if (this.sessions.size > 0 && waiting.every((s) => s.pending)) return;
    const interval = options.wake === true ? this.minTriggerInterval : this.triggerInterval;
    if (now - this.lastTriggerAt < interval) return;
    this.lastTriggerAt = now;
    this.triggerInterval = options.wake === true ? this.minTriggerInterval : Math.min(Math.max(this.triggerInterval * 2, 1), this.maxTriggerInterval);
    this.opts.log.log('link', `reconnect: ${reason}`);
    void this.say('hello');
  }

  send(peerId: string, data: Uint8Array): void {
    this.sessions.get(peerId)?.send(data);
  }

  /** Send on the direct link only, never the relay; false when there is none. */
  sendDirect(peerId: string, data: Uint8Array): boolean {
    return this.sessions.get(peerId)?.sendDirect(data) ?? false;
  }

  /** Test hook: close links as if the network dropped (one peer, or all). */
  dropForTest(peerId?: string): void {
    for (const s of this.sessions.values()) if (!peerId || s.peerId === peerId) s.dropForTest();
  }

  // ---- used by sessions ------------------------------------------------------------------------

  changed(): void {
    this.opts.onPeersChanged(this.peers);
  }

  randomId(): string {
    return this.opts.randomId?.() ?? crypto.randomUUID?.() ?? String(Math.random()).slice(2);
  }

  async say(type: SignalType, extra: Partial<SignalPayload> = {}): Promise<void> {
    if (this.signalingPausedUntil !== undefined) {
      // Every request while rate-limited fails and can extend the penalty; wait it out quietly.
      if (!this.pauseLogged) {
        this.pauseLogged = true;
        this.opts.log.log('signal', `publish ${type} skipped: paused while the signaling server is rate-limiting this network`);
      }
      return;
    }
    try {
      const payload: SignalPayload = { type, from: this.opts.selfId, sid: this.randomId(), ts: Date.now(), ...extra };
      const own = this.opts.identity?.own();
      let key = this.opts.key;
      if (own && type === 'hello') {
        // A pair whose key failed is left out: the peer then stops sealing with it too.
        payload.vp = [...this.sessions.values()].filter((x) => !x.pairBroken && this.opts.identity?.peer(x.peerId)).map((x) => peerTag(x.peerId));
      } else if (own) {
        payload.sig = await signSignal(own, this.opts.topic, payload);
        // Addressed to one certified device that can open it: only the two of them read the session description.
        const s = payload.to !== undefined ? this.sessions.get(payload.to) : undefined;
        if (s?.pairKey && ((type === 'offer' && s.listsMe) || (type === 'answer' && s.offerViaPair))) key = s.pairKey;
        if (s && type === 'offer') s.offerSentViaPair = s.pairKey !== undefined && key === s.pairKey ? Date.now() : 0;
      }
      await this.opts.transport.publish(this.opts.topic, await seal(key, this.opts.topic, payload));
    } catch (e) {
      this.opts.log.log('signal', `publish ${type} failed: ${e instanceof Error ? e.message : String(e)}`);
      if (e instanceof RateLimitedError) {
        const pause = Math.max(this.rateLimitPause, e.retryAfterMs ?? 0);
        this.pausedUntil = Date.now() + pause;
        this.pauseLogged = false;
        this.opts.log.log('signal', `pausing signaling for ${Math.round(pause / 1000)} s`);
        this.changed();
      }
    }
  }

  // ---- signaling -------------------------------------------------------------------------------

  private subscribe(): void {
    this.unsubscribe = this.opts.transport.subscribe(
      this.opts.topic,
      {
        onMessage: (m) => {
          this.lastMessageId = m.id;
          void this.handle(m);
        },
        onStatus: (status, detail) => {
          this.signalUp = status === 'connected';
          if (this.signalUp) {
            this.lastSignalActivity = Date.now();
            this.signalDownSince = 0;
            clearTimeout(this.problemTimer);
          } else if (this.signalDownSince === 0) {
            this.markSignalDown();
          }
          this.opts.log.log('signal', `${status}${detail ? ' ' + detail : ''}`);
        },
        onActivity: (serverTime) => {
          this.lastSignalActivity = Date.now();
          if (serverTime && serverTime > 0) this.serverSkewMs = serverTime * 1000 - Date.now();
        },
      },
      { since: this.lastMessageId ?? '5m' },
    );
  }

  /** The stream is down: start the clock, and tell listeners when the wait for a problem is over. */
  private markSignalDown(): void {
    this.signalDownSince = Date.now();
    clearTimeout(this.problemTimer);
    this.problemTimer = setTimeout(() => this.changed(), PROBLEM_AFTER_MS + 100);
  }

  /** Age of a message on the server's clock, so a device with a wrong clock still judges freshness. */
  private ageOf(m: InboxMessage, payload: SignalPayload): number {
    const sentAt = m.time > 0 ? m.time * 1000 : payload.ts;
    return Date.now() + this.serverSkewMs - sentAt;
  }

  /** Open with the shared key, else with the pair key of a certified peer. */
  private async openAny(text: string): Promise<{ opened: Opened; viaPair: string | undefined }> {
    try {
      return { opened: await open(this.opts.key, this.opts.topic, text), viaPair: undefined };
    } catch (e) {
      for (const s of this.sessions.values()) {
        if (!s.pairKey) continue;
        try {
          return { opened: await open(s.pairKey, this.opts.topic, text), viaPair: s.peerId };
        } catch {
          // Not this pair's.
        }
      }
      throw e;
    }
  }

  /** The pair key with this peer, when both devices are certified (it is used to send only once the peer says it verified this device). */
  async refreshPair(session: Session): Promise<void> {
    const own = this.opts.identity?.own();
    const peer = this.opts.identity?.peer(session.peerId);
    if (!own || !peer || session.pairBroken) {
      session.pairKey = undefined;
      session.pairFor = undefined;
      return;
    }
    const tag = `${peer.agree.x}:${peer.agree.y}`;
    if (session.pairFor === tag && session.pairOwn === own.agree) return;
    session.pairKey = await derivePairKey(own, peer, this.opts.topic, this.opts.selfId, session.peerId);
    session.pairFor = tag;
    session.pairOwn = own.agree;
  }

  /**
   * Certificates changed: work out every pair key again. Once keys are required, links that are not
   * proven are made again with a signed handshake (this device may have just got its certificate).
   */
  async refreshKeys(): Promise<void> {
    for (const s of this.sessions.values()) await this.refreshPair(s);
    if (!this.started || !this.opts.identity?.required() || !this.opts.identity.own()) return;
    let hello = false;
    for (const s of this.sessions.values()) {
      if (s.verified) continue;
      if (s.isInitiator) void s.attempt('device keys', true, true);
      else hello = true;
    }
    if (hello) void this.say('hello');
  }

  /** The link to this peer was proven with its device key (a signed handshake, or the pair-key relay). */
  isVerified(peerId: string): boolean {
    return this.sessions.get(peerId)?.verified ?? false;
  }

  private async handle(m: InboxMessage): Promise<void> {
    let payload: SignalPayload;
    let age: number;
    /** The peer whose pair key opened the message, if one did. */
    let viaPair: string | undefined;
    try {
      const got = await this.openAny(m.message);
      const opened = got.opened;
      viaPair = got.viaPair;
      payload = opened.payload;
      age = this.ageOf(m, payload);
      if (!this.guard.accept(opened.nonce, age)) {
        this.opts.log.log('signal', 'dropped: replay or too old');
        return;
      }
    } catch {
      this.opts.log.log('signal', 'dropped: could not authenticate');
      // Perhaps a peer sealed it with a pair key this device derives differently: a hello tells it this device is
      // here and did not answer, so it falls back to the shared key (`breakPair`). At most every few seconds.
      if (this.opts.identity && Date.now() - this.unreadableHelloAt > HELLO_REPLY_INTERVAL_MS) {
        this.unreadableHelloAt = Date.now();
        void this.say('hello');
      }
      return;
    }
    if (!this.started || payload.from === this.opts.selfId) return;
    // Sealed with one pair's key: only that peer could have sent it.
    if (viaPair !== undefined && viaPair !== payload.from) return;
    if (payload.to !== undefined && payload.to !== this.opts.selfId) return;
    if (this.opts.isBlocked?.(payload.from)) return;

    let session = this.sessions.get(payload.from);
    if (!session) {
      if (this.sessions.size >= this.maxPeers) {
        this.opts.log.log('link', 'ignored a device: too many peers');
        return;
      }
      session = new Session(payload.from, this);
      this.sessions.set(payload.from, session);
      this.opts.log.log('link', `peer ${payload.from.slice(0, 8)} identified`);
      this.changed();
    }
    session.lastSeenAt = Date.now();
    // Somebody answered: background triggers may act promptly again.
    this.triggerInterval = this.minTriggerInterval;

    const identity = this.opts.identity;
    if (payload.type === 'hello') {
      // A hello without the list is from an older build or a device without a certificate: nothing is sealed with the pair key for it.
      session.listsMe = !!payload.vp?.includes(peerTag(this.opts.selfId));
      await this.refreshPair(session);
    } else if (identity) {
      if (payload.sig === undefined) session.listsMe = false;
      else await this.refreshPair(session);
      session.offerViaPair = payload.type === 'offer' && viaPair === payload.from;
      const verified = await verifySignal(identity.peer(payload.from), this.opts.topic, payload);
      if (!verified && identity.required()) {
        session.log(`refused ${payload.type}: no valid device key`);
        return;
      }
      if (!verified && payload.sig !== undefined) session.log(`${payload.type} signature not verified; syncing as before (compatible mode)`);
      session.signalVerified = verified;
    }

    if (payload.type === 'hello') {
      // Keys required: a link that is not proven carries nothing, so it is made again with a signed handshake.
      const unproven = session.linkOpen && !!identity?.required() && !session.verified;
      // The peer is talking after an offer sealed with the pair key: if that offer is still unanswered a moment later, offer again (`attempt` falls back).
      const sent = session.offerSentViaPair;
      if (session.isInitiator && !session.linkOpen && sent > 0) {
        setTimeout(() => {
          if (this.started && session.offerSentViaPair === sent && !session.linkOpen) void session.attempt('pair-key offer unanswered', true);
        }, PAIR_ANSWER_MS);
      }
      if (session.isInitiator && (!session.linkOpen || unproven)) void session.attempt('peer hello', unproven, unproven);
      else if (!session.isInitiator && !session.linkOpen && age < 10_000 && payload.to === undefined) {
        // Answer a fresh broadcast hello so a peer that subscribed after our last hello learns that
        // we are here: the relay keeps no history to tell it. The reply is addressed to that peer
        // only, so other devices ignore it and replies never cascade; rate-limited per peer.
        if (Date.now() - session.lastHelloReplyAt > HELLO_REPLY_INTERVAL_MS) {
          session.replyHello();
        } else if (identity?.required()) {
          // Dropping it would strand a peer that restarted its mesh a moment after our last reply (a share member
          // coming back): it waits for our hello to offer, and we wait for its hello. Answer when the interval is over (#30).
          session.replyHelloLater();
        }
      }
    } else if (payload.type === 'offer') {
      if (!session.isInitiator && payload.to === this.opts.selfId) await session.respond(payload, age);
    } else if (payload.type === 'answer') {
      if (session.isInitiator) await session.acceptAnswer(payload);
    }
  }
}

/** One device pair: the rules of the single-peer manager, for one peer. */
class Session {
  state: LinkState = 'waiting-for-peer';
  link: LinkEndpoint | undefined;
  linkOpen = false;
  lastConnectedAt: number | undefined;
  lastSeenAt: number | undefined;
  lastHelloReplyAt = 0;
  relayOpen = false;
  /** Pair key with this peer, for which peer key and own key (`refreshPair`). */
  pairKey: CryptoKey | undefined;
  pairFor: string | undefined;
  pairOwn: CryptoKey | undefined;
  /** The peer's last hello listed this device as verified. */
  listsMe = false;
  /** The pair key failed once (#256): the shared key for the rest of this session. Never while keys are required. */
  pairBroken = false;
  /** When the last offer went out sealed with the pair key (0: with the shared key). */
  offerSentViaPair = 0;
  /** The last offer arrived sealed with the pair key, so the answer may be too. */
  offerViaPair = false;
  /** The offer or answer just handled carried a valid signature. */
  signalVerified = false;
  /** The link generation whose offer and answer were verified, and whether the open paths are. */
  private verifiedGen = -1;
  private linkVerified = false;
  private relayVerified = false;
  private relay: RelayEndpoint | undefined;
  private relayTimer: ReturnType<typeof setTimeout> | undefined;
  private relayIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private relayDropTimer: ReturnType<typeof setTimeout> | undefined;
  private upgradeTimer: ReturnType<typeof setTimeout> | undefined;
  private everConnected = false;
  private generation = 0;
  private attemptSid: string | undefined;
  private readonly handledOffers = new Set<string>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private helloReplyTimer: ReturnType<typeof setTimeout> | undefined;
  private retryIndex = 0;
  private attemptStartedAt = 0;

  constructor(
    readonly peerId: string,
    private readonly mesh: PeerMesh,
  ) {}

  get isInitiator(): boolean {
    return this.mesh.selfId < this.peerId;
  }

  info(): PeerInfo {
    return {
      id: this.peerId,
      state: this.state,
      ...(this.state === 'connected' ? { via: this.linkOpen ? ('direct' as const) : ('relay' as const) } : {}),
      ...(this.lastConnectedAt !== undefined ? { lastConnectedAt: this.lastConnectedAt } : {}),
      ...(this.lastSeenAt !== undefined ? { lastSeenAt: this.lastSeenAt } : {}),
      ...(this.pairBroken ? { sharedKey: true } : {}),
    };
  }

  /** An offer or answer is out and its link has not opened or given up yet. */
  get pending(): boolean {
    return !this.linkOpen && this.link !== undefined;
  }

  resetRetries(): void {
    this.retryIndex = 0;
  }

  send(data: Uint8Array): void {
    if (this.linkOpen) this.link?.send(data);
    else if (this.relayOpen) this.relay?.send(data);
  }

  sendDirect(data: Uint8Array): boolean {
    if (!this.linkOpen) return false;
    this.link?.send(data);
    return true;
  }

  dropForTest(): void {
    this.link?.close();
  }

  /** Answer a peer's hello with one addressed to it (the peer then offers if its id is the lower). */
  replyHello(): void {
    clearTimeout(this.helloReplyTimer);
    this.helloReplyTimer = undefined;
    this.lastHelloReplyAt = Date.now();
    void this.mesh.say('hello', { to: this.peerId });
  }

  /** A hello arrived within the reply interval of the last answer: answer it when the interval is over, unless linked by then. */
  replyHelloLater(): void {
    if (this.helloReplyTimer !== undefined) return;
    const wait = Math.max(0, this.lastHelloReplyAt + HELLO_REPLY_INTERVAL_MS - Date.now()) + 100;
    this.helloReplyTimer = setTimeout(() => {
      this.helloReplyTimer = undefined;
      if (this.mesh.isStarted && !this.linkOpen && !this.mesh.opts.isBlocked?.(this.peerId)) this.replyHello();
    }, wait);
  }

  close(): void {
    clearTimeout(this.helloReplyTimer);
    this.helloReplyTimer = undefined;
    clearTimeout(this.retryTimer);
    this.relayOpen = false;
    this.stopRelay();
    this.dropLink();
    this.setState('waiting-for-peer');
  }

  log(text: string): void {
    this.mesh.opts.log.log('link', `${this.peerId.slice(0, 8)}: ${text}`);
  }

  /**
   * The pair key did not work with this device (an unreadable relay frame, or an offer sealed with it
   * that the device, still talking, never answered): use the shared key for the rest of this session,
   * and say so in the next hello so the other device stops using it too.
   */
  breakPair(reason: string): void {
    if (this.pairBroken || this.mesh.opts.identity?.required()) return;
    this.pairBroken = true;
    this.pairKey = undefined;
    this.pairFor = undefined;
    this.log(`warning: pair key failed (${reason}); using the shared key with this device until the page reloads`);
    this.mesh.changed();
    void this.mesh.say('hello', { to: this.peerId });
  }

  get verified(): boolean {
    return this.linkOpen ? this.linkVerified : this.relayOpen && this.relayVerified;
  }

  private setState(state: LinkState): void {
    // A relay path keeps the device connected while direct attempts come and go.
    if (this.relayOpen && state !== 'connected') return;
    if (state === this.state) return;
    this.state = state;
    this.log(`state ${state}`);
    this.mesh.changed();
  }

  /** Initiator: make a fresh offer for this peer; re-offer a couple of times, then wait. */
  async attempt(reason: string, force = false, replaceUnproven = false): Promise<void> {
    if (!this.isInitiator || (this.linkOpen && !(replaceUnproven && !this.verified))) return;
    if (this.linkOpen) {
      // Keys required and this link is not proven: it carries nothing, so it is replaced by a signed one.
      this.dropLink();
      if (!this.relayOpen) this.mesh.opts.onLinkClose(this.peerId, 'replaced by a signed connection');
    }
    if (!force && reason !== 'retry' && this.link && Date.now() - this.attemptStartedAt < ATTEMPT_GRACE_MS) {
      this.log(`offer skipped (${reason}): one is already in flight`);
      return;
    }
    // The last offer went out with the pair key and the device, still talking, never answered: it may not be able to read it.
    if (this.offerSentViaPair > 0 && (this.lastSeenAt ?? 0) > this.offerSentViaPair) this.breakPair('offer not answered');
    this.attemptStartedAt = Date.now();
    clearTimeout(this.retryTimer);
    this.dropLink();
    const gen = ++this.generation;
    const sid = this.mesh.randomId();
    this.attemptSid = sid;
    this.setState(this.everConnected ? 'reconnecting' : 'connecting');
    this.log(`offer (${reason})`);
    const link = this.mesh.opts.createLink(this.eventsFor(gen));
    this.link = link;
    this.armRelay();
    try {
      const { code } = await link.createOffer();
      if (gen === this.generation) await this.mesh.say('offer', { sid, code, to: this.peerId });
    } catch (e) {
      this.log(`offer failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (gen !== this.generation) return;
    const delay = this.mesh.retryDelays[this.retryIndex++];
    if (delay !== undefined) {
      this.retryTimer = setTimeout(() => void this.attempt('retry'), delay);
    } else {
      this.retryTimer = setTimeout(() => {
        if (gen === this.generation && !this.linkOpen) {
          this.dropLink();
          this.setState('waiting-for-peer');
        }
      }, 15_000);
    }
  }

  async acceptAnswer(answer: SignalPayload): Promise<void> {
    if (answer.sid !== this.attemptSid || !this.link || !answer.code) return;
    this.offerSentViaPair = 0;
    this.verifiedGen = this.signalVerified ? this.generation : -1;
    try {
      await this.link.acceptAnswer(answer.code);
    } catch (e) {
      this.log(`answer rejected: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Responder: answer a fresh offer from this peer. */
  async respond(offer: SignalPayload, age: number): Promise<void> {
    if (!offer.code || this.handledOffers.has(offer.sid)) return;
    if (age > this.mesh.maxOfferAge) {
      this.log('ignored an old offer from the cache');
      return;
    }
    this.handledOffers.add(offer.sid);
    const wasOpen = this.linkOpen;
    this.dropLink();
    if (wasOpen && !this.relayOpen) this.mesh.opts.onLinkClose(this.peerId, 'replaced by a new connection');
    const gen = ++this.generation;
    this.verifiedGen = this.signalVerified ? gen : -1;
    this.setState(this.everConnected ? 'reconnecting' : 'connecting');
    this.log('answering offer');
    const link = this.mesh.opts.createLink(this.eventsFor(gen));
    this.link = link;
    this.armRelay();
    try {
      const { code } = await link.acceptOffer(offer.code);
      if (gen === this.generation) await this.mesh.say('answer', { sid: offer.sid, code, to: this.peerId });
    } catch (e) {
      this.log(`could not answer: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- relay path --------------------------------------------------------------------------------

  /** Start the relay if no direct link has opened a few seconds after an offer or answer. */
  private armRelay(): void {
    if (!this.mesh.opts.createRelay || this.relay || this.relayTimer !== undefined) return;
    this.relayTimer = setTimeout(() => {
      this.relayTimer = undefined;
      if (!this.linkOpen) this.startRelay();
    }, this.mesh.opts.relayAfterMs ?? 5000);
  }

  /** The mesh is pausing connections: drop a relay socket that is still waiting for the other device. */
  pauseRelay(): void {
    if (!this.relayOpen) this.stopRelay();
  }

  /** A forced reconnect: replace a relay socket that may have died with the network. */
  refreshRelay(): void {
    if (!this.relay || this.linkOpen) return;
    this.stopRelay();
    this.startRelay();
  }

  private startRelay(): void {
    const create = this.mesh.opts.createRelay;
    if (!create || this.relay || !this.mesh.isStarted || this.mesh.signalingPausedUntil !== undefined) return;
    const required = this.mesh.opts.identity?.required() ?? false;
    if (required && !this.pairKey) {
      this.log('relay skipped: no pair key with this device');
      return;
    }
    // Keys required: both ends are certified, so both derive it. Otherwise only once the peer said it can.
    const pair = this.pairKey && (required || this.listsMe) ? this.pairKey : undefined;
    this.log(pair ? 'trying the relay (pair key)' : 'trying the relay');
    this.relayVerified = !!pair && required;
    this.relay = create(this.peerId, {
      onOpen: () => this.relayUp(),
      onClose: (reason) => this.relayDown(reason),
      onMessage: (data) => this.mesh.opts.onLinkData(this.peerId, data, 'relay'),
      onLimit: (reason) => this.mesh.noteRelayLimit(reason),
      onPairFailed: () => this.breakPair('relay'),
    }, pair ? { key: pair, only: required } : undefined);
    this.relay.start();
    this.armRelayIdle();
  }

  private armRelayIdle(): void {
    clearTimeout(this.relayIdleTimer);
    this.relayIdleTimer = setTimeout(() => {
      if (!this.relayOpen) {
        this.log('other device is not on the relay; closing it');
        this.stopRelay();
      }
    }, this.mesh.opts.relayIdleMs ?? 10 * 60_000);
  }

  private relayUp(): void {
    clearTimeout(this.relayIdleTimer);
    if (this.relayOpen) return;
    this.relayOpen = true;
    this.mesh.noteRelayLimit(undefined);
    if (this.linkOpen) {
      this.mesh.changed();
      return;
    }
    this.everConnected = true;
    this.lastConnectedAt = Date.now();
    this.log('connected through the relay');
    this.setState('connected');
    this.mesh.changed();
    this.mesh.opts.onLinkOpen(this.peerId);
    this.scheduleUpgrade();
  }

  private relayDown(reason: string): void {
    if (!this.relayOpen) return;
    this.relayOpen = false;
    this.armRelayIdle();
    if (this.linkOpen) {
      this.mesh.changed();
      return;
    }
    this.log(`relay path ended: ${reason}`);
    this.mesh.opts.onLinkClose(this.peerId, reason);
    this.setState('reconnecting');
  }

  /** While on the relay, the initiator keeps looking for a direct path. */
  private scheduleUpgrade(): void {
    clearTimeout(this.upgradeTimer);
    if (!this.isInitiator) return;
    this.upgradeTimer = setTimeout(() => {
      if (!this.relayOpen || this.linkOpen) return;
      void this.attempt('direct path check', true);
      this.scheduleUpgrade();
    }, this.mesh.opts.directRetryMs ?? 60_000);
  }

  private stopRelay(): void {
    clearTimeout(this.relayTimer);
    clearTimeout(this.relayIdleTimer);
    clearTimeout(this.relayDropTimer);
    clearTimeout(this.upgradeTimer);
    this.relayTimer = undefined;
    const relay = this.relay;
    this.relay = undefined;
    relay?.close();
    const was = this.relayOpen;
    this.relayOpen = false;
    if (!was) return;
    if (!this.linkOpen) {
      this.mesh.opts.onLinkClose(this.peerId, 'relay closed');
      this.setState('reconnecting');
    }
    this.mesh.changed();
  }

  private dropLink(): void {
    this.generation++;
    const wasDirect = this.linkOpen;
    this.linkOpen = false;
    if (wasDirect) this.mesh.opts.onDirectChange?.(this.peerId, false);
    const link = this.link;
    this.link = undefined;
    link?.close();
  }

  private eventsFor(gen: number): PeerLinkEvents {
    return {
      onOpen: () => {
        if (gen !== this.generation) return;
        const onRelay = this.relayOpen;
        this.linkOpen = true;
        this.linkVerified = this.verifiedGen === gen;
        this.mesh.opts.onDirectChange?.(this.peerId, true);
        this.everConnected = true;
        this.lastConnectedAt = Date.now();
        this.retryIndex = 0;
        clearTimeout(this.retryTimer);
        clearTimeout(this.relayTimer);
        clearTimeout(this.upgradeTimer);
        this.setState('connected');
        if (onRelay) {
          // Already syncing through the relay: only the path changes. Give the other device a
          // moment to finish with the relay too, then let it go.
          this.log('direct path opened; leaving the relay');
          this.relayDropTimer = setTimeout(() => this.stopRelay(), RELAY_HANDOVER_MS);
          this.mesh.changed();
        } else {
          this.stopRelay();
          this.mesh.opts.onLinkOpen(this.peerId);
        }
      },
      onMessage: (data) => {
        if (gen === this.generation) this.mesh.opts.onLinkData(this.peerId, data, 'direct');
      },
      onClose: (reason) => {
        if (gen !== this.generation) return;
        const wasOpen = this.linkOpen;
        this.dropLink();
        if (wasOpen && !this.relayOpen) this.mesh.opts.onLinkClose(this.peerId, reason);
        if (this.relayOpen) this.mesh.changed();
        this.setState('reconnecting');
        if (this.isInitiator) setTimeout(() => void this.attempt('link lost'), 250);
        else void this.mesh.say('hello');
      },
      onWaitTimeout: () => {
        // The session has its own attempt timers.
      },
    };
  }
}
