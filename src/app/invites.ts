import { readAccountKeys } from '../core/account-keys';
import { KEYS_REQUIRED_LEVEL } from '../core/account-keys';
import { checkApproval } from '../core/key-certs';
import { deviceName, setDeviceName, suggestedName } from '../core/devices';
import { encodeText } from '../core/bytes';
import { wrapFor } from '../core/keys';
import type { DocumentStore } from '../core/doc-store';
import { InviteGuest, InviteHost, type JoinRequest } from '../sync/invite';
import { ownDeviceKeys } from '../sync/key-store';
import { generateSecret, normalizeSecret } from '../sync/pairing-secret';
import type { SignalingTransport } from '../sync/signaling';
import type { SyncService } from '../sync/sync-service';
import { createTransport } from '../sync/transport-factory';
import type { StorageLike } from '../core/account-setup';
import type { AccountState } from './account-state';
import { keyTrust, ownerKeys } from './account-keys-runtime';
import { adoptApprovedAccount } from './join';
import { joinState, type JoinState } from './join-state';
import { setPendingJoins } from './needs';

/**
 * Approval pairing in the running app (#257). The new device's side runs with every join by code:
 * in a compatible account the code is the account's own and the join request goes unanswered; in a
 * keys-required account the code is a one-time invite and an enrolled device answers. The approving
 * side opens an invite on Devices, shows each request with its comparison code, and approves with
 * the passphrase (`ownerKeys`).
 */


export interface InviteRequest {
  request: JoinRequest;
  compare: string;
  state: 'waiting' | 'approving' | 'approved' | 'declined';
  error?: string;
}

export interface HostState {
  code: string;
  signalingUrl: string;
  expiresAt: number;
  requests: InviteRequest[];
  /** Devices that tried the code with an older Yak. */
  oldBuilds: string[];
  /** The code admitted a device: it takes no other. */
  used: boolean;
}

interface Deps {
  store: DocumentStore;
  state: AccountState;
  sync: SyncService;
  storage: StorageLike;
  me: string;
  transport?: (url: string) => SignalingTransport;
}

class Invites {
  private deps: Deps | undefined;
  private guest: InviteGuest | undefined;
  private host: InviteHost | undefined;
  hosting: HostState | undefined;
  private readonly listeners = new Set<() => void>();
  private configured!: () => void;
  /** Settles once `main.tsx` has configured this (it loads on demand, perhaps after a page asked to join). */
  private readonly ready = new Promise<void>((r) => (this.configured = r));

  configure(deps: Deps): void {
    this.deps = deps;
    this.configured();
  }

  get join(): JoinState | undefined {
    return joinState.get();
  }

  private setJoin(j: JoinState): void {
    joinState.set(j);
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    // The shell shows a waiting join (Settings tab dot, Needs you) without loading this module.
    setPendingJoins(
      (this.hosting?.requests ?? []).filter((r) => r.state === 'waiting' || r.state === 'approving').map((r) => ({ deviceId: r.request.deviceId, ...(r.request.name ? { name: r.request.name } : {}), expiresAt: this.hosting?.expiresAt ?? 0 })),
    );
    for (const l of this.listeners) l();
  }

  private transport(url: string): SignalingTransport {
    return (this.deps?.transport ?? createTransport)(url);
  }

  private last: { code: string; signalingUrl: string } | undefined;

  /** Join with a one-time invite: this device makes keys and asks to be approved (#311). An account's own sync code admits nobody. */
  async joinWithCode(code: string, signalingUrl: string, name?: string): Promise<void> {
    await this.ready;
    const d = this.deps as Deps;
    // The name asked for before joining is saved first, so the request carries it and the joined account keeps it.
    if (name?.trim()) setDeviceName(d.state.doc, d.me, name.trim());
    normalizeSecret(code);
    this.last = { code, signalingUrl };
    await this.ask(d);
  }

  /** The person saw the same code on both screens. */
  confirmJoin(): void {
    this.guest?.confirm();
    if (this.join?.phase === 'compare') this.setJoin({ ...this.join, confirmed: true });
  }

  /** Declined: stop using this code, so another one can be entered. */
  async forgetJoinCode(): Promise<void> {
    await this.ready;
    this.guest?.stop();
    this.guest = undefined;
    this.deps?.sync.unpair();
    joinState.set(undefined);
    this.emit();
  }

  /** The codes did not match (someone else answered first): ask again from the start. */
  async restartJoin(): Promise<void> {
    await this.ready;
    if (this.deps && this.last) await this.ask(this.deps);
  }

  private async ask(d: Deps): Promise<void> {
    const last = this.last;
    if (!last) return;
    const { code, signalingUrl } = last;
    const own = await ownDeviceKeys().catch(() => null);
    if (!own) throw new Error('This browser cannot make device keys, so it cannot join an account. Use a current Chrome, Edge, Firefox or Safari.');
    this.guest?.stop();
    const request: JoinRequest = { deviceId: d.me, name: deviceName(d.state.doc, d.me) ?? suggestedName(navigator.userAgent), ...own.publicKeys, v: KEYS_REQUIRED_LEVEL };
    this.setJoin({ phase: 'asking' });
    const guest = new InviteGuest(code, this.transport(signalingUrl), request, {
      onSeen: (_account, _key, compare) => {
        this.setJoin({ phase: 'compare', compare });
      },
      onApproved: (a) =>
        void (async () => {
          const records = await checkApproval(a.records, a.account, d.me, own.publicKeys);
          if (!records) {
            this.setJoin({ phase: 'failed', error: 'The approval did not check out. Try again with a new code.' });
            return;
          }
          this.setJoin({ phase: 'approved' });
          await adoptApprovedAccount({ ...a, records }, { ...d, agreeKey: own.agree.privateKey });
        })().catch((e: unknown) => {
          this.setJoin({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
        }),
      // Not unpaired here: someone who answered first with the code could send this too, so the person chooses (#291).
      onDeclined: (why) => {
        this.setJoin({ phase: 'declined', ...(why === 'used' ? { used: true, error: 'This code was already used. Ask for a new one on your other device.' } : {}) });
      },
      // No answer: not a one-time code (an account's own sync code admits nobody), expired, or the other device is gone.
      onNoAnswer: () => {
        if (this.guest === guest && this.join?.phase === 'asking') this.setJoin({ phase: 'failed', error: 'Nobody answered that code. Make a new one-time code on a device that already syncs (Devices → Make a one-time code) and enter it here.' });
      },
    });
    this.guest = guest;
    await guest.start();
  }

  /** Open a one-time invite on this device (keys required). */
  async open(): Promise<void> {
    const d = this.deps;
    if (!d) throw new Error('Not ready yet.');
    if (!keyTrust.required()) throw new Error('Invites are for accounts that require device keys.');
    const secret = d.sync.secret;
    if (!secret) throw new Error('This device is not syncing.');
    this.close();
    // The new device shows this one by name: save a suggestion when the person has not named it.
    if (!deviceName(d.state.doc, d.me)) setDeviceName(d.state.doc, d.me, suggestedName(navigator.userAgent));
    const code = generateSecret();
    const signalingUrl = d.sync.status.signalingUrl;
    const fp = keyTrust.accountFp as string;
    const account = (await readAccountKeys(d.state.doc)).find((k) => k.fingerprint === fp);
    if (!account) throw new Error('The account key is missing.');
    const hosting: HostState = { code, signalingUrl, expiresAt: Date.now(), requests: [], oldBuilds: [], used: false };
    const host = new InviteHost(code, this.transport(signalingUrl), account, {
      onRequest: (request, compare) => {
        if (this.host !== host) return;
        hosting.requests = [...hosting.requests.filter((r) => r.request.deviceId !== request.deviceId), { request, compare, state: 'waiting' }];
        this.emit();
      },
      onUsed: (declined) => {
        hosting.requests = hosting.requests.map((r) => (declined.includes(r.request.deviceId) ? { ...r, state: 'declined' } : r));
        this.emit();
      },
      onOldBuild: (id) => {
        if (hosting.oldBuilds.includes(id)) return;
        hosting.oldBuilds = [...hosting.oldBuilds, id];
        this.emit();
      },
    });
    hosting.expiresAt = host.expiresAt;
    this.host = host;
    this.hosting = hosting;
    await host.start();
    this.emit();
    setTimeout(() => {
      if (this.host === host) this.close();
    }, host.expiresAt - Date.now());
  }

  close(): void {
    this.host?.stop();
    this.host = undefined;
    this.hosting = undefined;
    this.emit();
  }

  private update(deviceId: string, patch: Partial<InviteRequest>): void {
    if (!this.hosting) return;
    this.hosting.requests = this.hosting.requests.map((r) => (r.request.deviceId === deviceId ? { ...r, ...patch } : r));
    this.emit();
  }

  /** The owner compared the codes: certify the device and send it what it needs. Needs the passphrase unlocked. */
  async approve(deviceId: string): Promise<void> {
    const d = this.deps;
    const host = this.host;
    const r = this.hosting?.requests.find((x) => x.request.deviceId === deviceId);
    if (!d || !host || !r) return;
    const secret = d.sync.secret;
    if (!secret) throw new Error('This device is not syncing.');
    this.update(deviceId, { state: 'approving' });
    try {
      const { request } = r;
      const records = await ownerKeys.current.approve(deviceId, { keys: request, ...(request.name ? { name: request.name } : {}) });
      await host.approve(deviceId, {
        accountId: d.state.id,
        account: keyTrust.accountFp as string,
        records,
        secret: await wrapFor(request.agree, encodeText(secret)),
        signalingUrl: d.sync.status.signalingUrl,
      });
      if (this.hosting) this.hosting.used = true;
      this.update(deviceId, { state: 'approved' });
    } catch (e) {
      this.update(deviceId, { state: 'waiting', error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  async decline(deviceId: string): Promise<void> {
    await this.host?.decline(deviceId);
    this.update(deviceId, { state: 'declined' });
  }
}

/** One per page; `main.tsx` configures it. */
export const invites = new Invites();
