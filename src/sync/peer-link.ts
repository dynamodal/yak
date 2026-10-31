import { EventLog } from './event-log';
import { Joiner, pieceSize, split } from './link-chunks';
import { decodeSignal, encodeSignal } from './signal-codec';
import { type AttemptRecord, type AttemptStage, countCandidates as countKinds, natKind, type ParsedCandidate, samePublic, sdpCandidates } from './link-diagnostics';
import { DATA_CHANNEL_LABEL } from '../core/protocol-ids';

export interface PeerLinkEvents {
  onOpen(): void;
  onMessage(data: Uint8Array): void;
  /** The channel was open and then dropped. Not called for a pairing that never completed. */
  onClose(reason: string): void;
  /** Pairing did not complete in time after a code or reply was created. */
  onWaitTimeout(): void;
  /** How the attempt ended (#110): once, when the channel opens, the checks fail or the link is closed before either. */
  onAttempt?(record: AttemptRecord): void;
}

export interface OfferInfo {
  /** The pairing string to give to the other device. */
  code: string;
  /** Size of the string in characters; compare with the QR capacity (about 2900 bytes). */
  length: number;
  /** Candidate lines in the raw offer, before trimming. */
  rawCandidates: number;
  keptCandidates: number;
  /** Kept candidates that are `.local` names; those need mDNS resolution on the other device. */
  mdnsCandidates: number;
}

const CHANNEL_LABEL = DATA_CHANNEL_LABEL;

/** Stop handing pieces to the channel above this many buffered bytes; resume below the low mark. */
const BUFFER_HIGH = 1024 * 1024;
const BUFFER_LOW = 256 * 1024;

/** How long to wait for ICE gathering before using what has been found. */
const GATHER_TIMEOUT_MS = 4000;

/** How long a human may take to carry the code across before the page says pairing failed. */
const PAIRING_WAIT_MS = 120_000;

function countCandidates(sdp: string, pattern = /^a=candidate:/): number {
  return sdp.split(/\r?\n/).filter((l) => pattern.test(l)).length;
}

/**
 * One WebRTC data channel to one peer, paired by copying a string each way (no signaling
 * server). Without ICE servers only host candidates are produced (same network); with STUN servers
 * the device also learns its public address, so devices on different networks can connect.
 * The channel is DTLS-encrypted by WebRTC itself.
 */
export class PeerLink {
  private readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | undefined;
  /** True once the data channel has opened. Before that, ICE state changes are not disconnects. */
  private everOpen = false;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  /** Pieces waiting for the channel's send buffer to drain. */
  private queue: Uint8Array[] = [];
  private joiner = new Joiner();
  // Diagnostics for this attempt (#110). Candidates are held only while the attempt runs.
  private readonly startedAt = Date.now();
  private role: 'offer' | 'answer' = 'offer';
  private localCandidates: ParsedCandidate[] = [];
  private remoteCandidates: ParsedCandidate[] = [];
  private remoteSet = false;
  /** This side's description went out (its candidates are known). */
  private described = false;
  private iceUp = false;
  private iceFailed = false;
  private reported = false;

  constructor(
    private readonly events: PeerLinkEvents,
    private readonly log: EventLog,
    iceServers: RTCIceServer[] = [],
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.addEventListener('connectionstatechange', () => {
      this.log.log('peer', `connection ${this.pc.connectionState}`);
      const state = this.pc.connectionState;
      if (state !== 'failed' && state !== 'closed') return;
      if (this.everOpen) this.events.onClose(`connection ${state}`);
      else this.log.log('peer', 'failed before the channel opened; recovers if the other device finishes pairing');
    });
    this.pc.addEventListener('iceconnectionstatechange', () => {
      const ice = this.pc.iceConnectionState;
      this.log.log('ice', ice);
      if (ice === 'connected' || ice === 'completed') this.iceUp = true;
      if (ice === 'failed' && !this.everOpen) {
        this.iceFailed = true;
        void this.report();
      }
      if (this.everOpen && ice === 'disconnected') this.events.onClose('ice disconnected');
    });
    this.pc.addEventListener('icegatheringstatechange', () => {
      this.log.log('ice', `gathering ${this.pc.iceGatheringState}`);
    });
    this.pc.addEventListener('icecandidate', (e) => {
      const c = (e as RTCPeerConnectionIceEvent).candidate;
      if (c) this.log.log('ice', `candidate ${c.type ?? 'unknown'} ${c.protocol ?? ''}`.trim());
    });
    this.pc.addEventListener('datachannel', (e) => this.attach(e.channel));
  }

  /** Device A: create the channel and an offer to hand to the other device. */
  async createOffer(): Promise<OfferInfo> {
    this.role = 'offer';
    this.attach(this.pc.createDataChannel(CHANNEL_LABEL, { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    const info = await this.finishDescription('offer');
    this.startWaiting();
    return info;
  }

  /** Device B: take A's offer, return an answer to hand back. */
  async acceptOffer(code: string): Promise<OfferInfo> {
    const signal = await decodeSignal(code);
    if (signal.kind !== 'offer') throw new Error('That is an answer code; paste an offer code here');
    this.role = 'answer';
    await this.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
    this.remoteCandidates = sdpCandidates(signal.sdp);
    this.remoteSet = true;
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    const info = await this.finishDescription('answer');
    this.startWaiting();
    return info;
  }

  /** Device A: take B's answer; the channel opens when both sides are ready. */
  async acceptAnswer(code: string): Promise<void> {
    const signal = await decodeSignal(code);
    if (signal.kind !== 'answer') throw new Error('That is an offer code; paste an answer code here');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
    this.remoteCandidates = sdpCandidates(signal.sdp);
    this.remoteSet = true;
  }

  /** Sends in pieces the peer accepts (its max-message-size), in order, without overfilling the send buffer. */
  send(data: Uint8Array): void {
    if (this.channel?.readyState !== 'open') return;
    this.queue.push(...split(data, pieceSize(this.pc.sctp?.maxMessageSize)));
    this.flush();
  }

  private flush(): void {
    const channel = this.channel;
    if (channel?.readyState !== 'open') {
      this.queue = [];
      return;
    }
    try {
      while (this.queue.length > 0 && channel.bufferedAmount <= BUFFER_HIGH) {
        channel.send(this.queue.shift() as Uint8Array<ArrayBuffer>);
      }
    } catch (e) {
      // The rest of a split message is useless without this piece; the periodic re-sync repairs the gap.
      this.queue = [];
      this.log.log('channel', `send failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  get isOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  close(): void {
    if (!this.reported) this.finish(this.stage());
    clearTimeout(this.waitTimer);
    this.queue = [];
    this.channel?.close();
    this.pc.close();
  }

  /** Start the clock once a code or reply exists and a person has to carry it to the other device. */
  private startWaiting(): void {
    clearTimeout(this.waitTimer);
    this.waitTimer = setTimeout(() => {
      if (this.everOpen) return;
      this.log.log('pairing', `no channel after ${PAIRING_WAIT_MS / 1000} s`);
      this.events.onWaitTimeout();
    }, PAIRING_WAIT_MS);
  }

  /** How far the attempt got, judged when it ends without an open channel. */
  private stage(): AttemptStage {
    if (!this.remoteSet) return 'no-answer';
    if (this.described && !this.iceUp && (this.remoteCandidates.length === 0 || this.localCandidates.length === 0)) return 'no-candidates';
    if (this.iceUp) return 'secure-failed';
    return this.iceFailed ? 'checks-failed' : 'unfinished';
  }

  /** Reads the candidate pairs once (open or failed), logs the chosen path, then records the attempt. */
  private async report(): Promise<void> {
    const extra: Partial<AttemptRecord> = {};
    let prflxLocal = 0;
    let prflxRemote = 0;
    try {
      const stats = await this.pc.getStats();
      let pairId: string | undefined;
      let pairs = 0;
      stats.forEach((s) => {
        const t = s as unknown as Record<string, unknown>;
        if (t.type === 'transport' && typeof t.selectedCandidatePairId === 'string') pairId = t.selectedCandidatePairId;
        if (t.type === 'candidate-pair') pairs++;
        if (t.type === 'local-candidate' && t.candidateType === 'prflx') prflxLocal++;
        if (t.type === 'remote-candidate' && t.candidateType === 'prflx') prflxRemote++;
      });
      extra.pairs = pairs;
      const get = (id: unknown): Record<string, unknown> | undefined =>
        typeof id === 'string' ? (stats.get(id) as unknown as Record<string, unknown> | undefined) : undefined;
      const pair = this.everOpen ? get(pairId) : undefined;
      if (pair) {
        const local = get(pair.localCandidateId);
        const remote = get(pair.remoteCandidateId);
        const rtt = typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : undefined;
        this.log.log(
          'path',
          `${String(local?.candidateType)}/${String(remote?.candidateType)} ${String(local?.protocol)} local network ${String(local?.networkType ?? 'unknown')}${rtt !== undefined ? ` rtt ${rtt}ms` : ''}`,
        );
        extra.path = `${String(local?.candidateType)}/${String(remote?.candidateType)} ${String(local?.protocol)}`;
        if (rtt !== undefined) extra.rttMs = Math.round(rtt / 10) * 10;
      }
    } catch {
      // Stats are diagnostic only.
    }
    if (this.reported) return;
    this.finish(this.everOpen ? 'open' : this.stage(), extra, prflxLocal, prflxRemote);
  }

  private finish(stage: AttemptStage, extra: Partial<AttemptRecord> = {}, prflxLocal = 0, prflxRemote = 0): void {
    this.reported = true;
    const local = countKinds(this.localCandidates);
    const remote = countKinds(this.remoteCandidates);
    local.prflx += prflxLocal;
    remote.prflx += prflxRemote;
    const record: AttemptRecord = {
      at: this.startedAt,
      role: this.role,
      local,
      remote,
      natLocal: natKind(this.localCandidates),
      natRemote: natKind(this.remoteCandidates),
      samePublic: samePublic(this.localCandidates, this.remoteCandidates),
      stage,
      ...extra,
      ms: Date.now() - this.startedAt,
    };
    // Addresses are no longer needed once counted.
    this.localCandidates = [];
    this.remoteCandidates = [];
    try {
      this.events.onAttempt?.(record);
    } catch {
      // Diagnostics never break the link.
    }
  }

  private attach(channel: RTCDataChannel): void {
    this.channel = channel;
    this.queue = [];
    this.joiner = new Joiner();
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFER_LOW;
    channel.addEventListener('bufferedamountlow', () => this.flush());
    channel.addEventListener('open', () => {
      this.everOpen = true;
      clearTimeout(this.waitTimer);
      this.log.log('channel', 'open');
      void this.report();
      this.events.onOpen();
    });
    channel.addEventListener('close', () => {
      this.log.log('channel', 'close');
      if (this.everOpen) this.events.onClose('channel closed');
    });
    channel.addEventListener('message', (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const message = this.joiner.receive(new Uint8Array(e.data));
      if (message) this.events.onMessage(message);
    });
  }

  private async finishDescription(kind: 'offer' | 'answer'): Promise<OfferInfo> {
    await this.waitForGathering();
    const sdp = this.pc.localDescription?.sdp ?? '';
    const code = await encodeSignal({ kind, sdp });
    const kept = (await decodeSignal(code)).sdp;
    this.localCandidates = sdpCandidates(kept);
    this.described = true;
    return {
      code,
      length: code.length,
      rawCandidates: countCandidates(sdp),
      keptCandidates: countCandidates(kept),
      mdnsCandidates: countCandidates(kept, /^a=candidate:.*\.local /),
    };
  }

  private waitForGathering(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      };
      const onChange = (): void => {
        if (this.pc.iceGatheringState === 'complete') done();
      };
      const timer = setTimeout(done, GATHER_TIMEOUT_MS);
      this.pc.addEventListener('icegatheringstatechange', onChange);
    });
  }
}
