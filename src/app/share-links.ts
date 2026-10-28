import * as Y from 'yjs';
import { STORAGE_PREFIX } from '../constants';
import { addSpace, freeSpaceName, readSpaces } from '../core/account';
import { noteSharedSince } from '../core/account-labels';
import { keysMap, readAccountKeys } from '../core/account-keys';
import type { StorageLike } from '../core/account-setup';
import { deviceName, suggestedName } from '../core/devices';
import { spaceDocId, type DocumentStore } from '../core/doc-store';
import { setKeeps } from '../core/keeps';
import { readRemovals } from '../core/key-removals';
import { sameKey } from '../core/keys';
import { acceptableRoster, applyRoster, memoryPins, readShare, setShareAnchor } from '../core/shares';
import { generateSecret, normalizeSecret } from '../sync/pairing-secret';
import { ShareGuest, ShareHost, type ShareAsk } from '../sync/share-link';
import type { SignalingTransport } from '../sync/signaling';
import { createTransport, defaultSignalingUrl } from '../sync/transport-factory';
import type { AccountState } from './account-state';
import type { AccountKeys, KeyTrust } from './account-keys-runtime';
import type { Shares } from './shares-runtime';

/**
 * The share link in the running app (#259): the owner's side (open a link for a space, approve the asking account
 * after comparing a code) and the joining account's side (open the link, compare, follow the approval).
 * Like `invites.ts`, but between two accounts.
 */

const NAME_KEY = `${STORAGE_PREFIX}-share-name`;
const SPACE_ID = /^[a-f0-9]{24}$/;

export interface ShareRequest {
  ask: ShareAsk;
  compare: string;
  state: 'waiting' | 'approving' | 'approved' | 'declined';
  error?: string;
}

export interface HostState {
  space: string;
  spaceName: string;
  code: string;
  expiresAt: number;
  requests: ShareRequest[];
  used: boolean;
}

export interface ShareJoinState {
  phase: 'asking' | 'compare' | 'adding' | 'done' | 'declined' | 'failed';
  compare?: string;
  spaceName?: string;
  confirmed?: boolean;
  used?: boolean;
  error?: string;
}

export interface ShareLinkDeps {
  store: DocumentStore;
  state: AccountState;
  trust: KeyTrust;
  keys: () => AccountKeys;
  shares: Shares;
  me: string;
  storage: StorageLike;
  transport?: (url: string) => SignalingTransport;
}

/** The link a person opens: the code is in the fragment, which the server never sees. */
export function shareLinkUrl(code: string, base = `${location.origin}${location.pathname}`): string {
  return `${base}#/share/${normalizeSecret(code)}`;
}

/** The code in a share link's fragment, or undefined. */
export function shareCodeOf(hash: string): string | undefined {
  const m = /^#\/share\/([A-Za-z0-9-]+)$/.exec(hash);
  if (!m) return undefined;
  try {
    return normalizeSecret(m[1] as string);
  } catch {
    return undefined;
  }
}

/** Every asker has been answered and the link is used up: it is spent, whatever its timer says. */
export function linkSettled(h: HostState | undefined): boolean {
  return !!h && h.used && h.requests.length > 0 && h.requests.every((r) => r.state === 'approved' || r.state === 'declined');
}

export class ShareLinks {
  private deps: ShareLinkDeps | undefined;
  private host: ShareHost | undefined;
  private guest: ShareGuest | undefined;
  hosting: HostState | undefined;
  join: ShareJoinState | undefined;
  private readonly listeners = new Set<() => void>();

  configure(deps: ShareLinkDeps): void {
    this.deps = deps;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private d(): ShareLinkDeps {
    if (!this.deps) throw new Error('Not ready yet.');
    return this.deps;
  }

  private transport(): SignalingTransport {
    const d = this.d();
    return (d.transport ?? createTransport)(defaultSignalingUrl());
  }

  /** The name this person shows to the other account: remembered, else this device's name. */
  displayName(): string {
    const d = this.d();
    return d.storage.getItem(NAME_KEY) || deviceName(d.state.doc, d.me) || suggestedName(navigator.userAgent);
  }

  /** The name offered when making a link: remembered, else this device's name you chose; never a guess from the browser. */
  ownerName(): string {
    const d = this.d();
    return d.storage.getItem(NAME_KEY) || deviceName(d.state.doc, d.me) || '';
  }

  rememberName(name: string): void {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (clean) this.d().storage.setItem(NAME_KEY, clean);
  }

  // --- owner ---

  /** Make the space a share (if it is not) and open a one-time link for one account. Needs the passphrase unlocked. */
  async open(space: string, name: string): Promise<void> {
    const d = this.d();
    if (!d.trust.required()) throw new Error('Device keys are required first.');
    const spaceName = readSpaces(d.state.doc).find((s) => s.id === space)?.storedName;
    if (!spaceName) throw new Error('That space no longer exists.');
    this.rememberName(name);
    const state = await d.shares.create(space, name.trim() || this.displayName());
    const owner = state.members.get(state.owner);
    if (!owner) throw new Error('The share has no owner.');
    this.close();
    const code = generateSecret();
    const hosting: HostState = { space, spaceName, code, expiresAt: Date.now(), requests: [], used: false };
    const host = new ShareHost(code, this.transport(), { fingerprint: owner.fp, publicKey: owner.key }, spaceName, {
      onRequest: (ask, compare) => {
        if (this.host !== host) return;
        hosting.requests = [...hosting.requests.filter((r) => r.ask.deviceId !== ask.deviceId), { ask, compare, state: 'waiting' }];
        this.emit();
      },
      onUsed: (declined) => {
        hosting.requests = hosting.requests.map((r) => (declined.includes(r.ask.deviceId) ? { ...r, state: 'declined' } : r));
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

  private update(deviceId: string, patch: Partial<ShareRequest>): void {
    if (!this.hosting) return;
    this.hosting.requests = this.hosting.requests.map((r) => (r.ask.deviceId === deviceId ? { ...r, ...patch } : r));
    this.emit();
  }

  /** The owner compared the codes: add the account and send it the roster. Needs the passphrase unlocked. */
  async approve(deviceId: string): Promise<void> {
    const host = this.host;
    const hosting = this.hosting;
    const r = hosting?.requests.find((x) => x.ask.deviceId === deviceId);
    if (!host || !hosting || !r) return;
    this.update(deviceId, { state: 'approving' });
    try {
      const approval = await this.d().shares.approve(hosting.space, r.ask);
      await host.approve(deviceId, approval);
      hosting.used = true;
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

  // --- the joining account ---

  /** Open a share link on a device of an account that requires keys. */
  async ask(code: string, name: string): Promise<void> {
    const d = this.d();
    const fp = d.trust.accountFp;
    if (!d.trust.required() || !fp) throw new Error('Require device keys on this account first (Devices).');
    if (!d.trust.proof) throw new Error('This device is not approved in its account yet.');
    const record = (await readAccountKeys(d.state.doc)).find((k) => k.fingerprint === fp);
    if (!record) throw new Error('The account key is missing.');
    this.rememberName(name);
    const keys = keysMap(d.state.doc);
    const records: [string, unknown][] = [];
    for (const id of d.trust.certs.keys()) records.push([`cert:${id}`, keys.get(`cert:${id}`)]);
    for (const r of await readRemovals(d.state.doc, record)) records.push([`removal:${r.deviceId}`, keys.get(`removal:${r.deviceId}`)]);
    const ask: ShareAsk = { deviceId: d.me, name: name.trim() || this.displayName(), account: fp, key: record.publicKey, records };
    this.guest?.stop();
    this.setJoin({ phase: 'asking' });
    const guest = new ShareGuest(normalizeSecret(code), this.transport(), ask, {
      onSeen: (_owner, _key, spaceName, compare) => this.setJoin({ phase: 'compare', compare, spaceName }),
      onApproved: (a) =>
        void this.adopt(a, fp, record.publicKey).catch((e: unknown) => {
          this.setJoin({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
        }),
      onDeclined: (why) => this.setJoin({ phase: 'declined', ...(why === 'used' ? { used: true, error: 'This link was already used. Ask for a new one.' } : {}) }),
      onNoAnswer: () => {
        if (this.guest === guest && this.join?.phase === 'asking') this.setJoin({ phase: 'failed', error: 'Nobody answered. The link may have expired, or the owner closed it. Ask for a new one.' });
      },
      onFailed: (e) => this.setJoin({ phase: 'failed', error: e.message }),
    });
    this.guest = guest;
    await guest.start();
  }

  /** The person saw the same code on both screens. */
  confirm(): void {
    this.guest?.confirm();
    if (this.join?.phase === 'compare') this.setJoin({ ...this.join, confirmed: true });
  }

  /** Stop asking and forget the state. */
  cancel(): void {
    this.guest?.stop();
    this.guest = undefined;
    this.setJoin(undefined);
  }

  private setJoin(j: ShareJoinState | undefined): void {
    this.join = j;
    this.emit();
  }

  /** The approval: check the roster it carries as any device would, then add the space and trust its owner. */
  private async adopt(a: { account: string; space: string; spaceName: string; records: [string, unknown][] }, fp: string, key: import('../core/keys').PublicKeyJwk): Promise<void> {
    const d = this.d();
    if (!SPACE_ID.test(a.space)) throw new Error('The share names no valid space.');
    const records = acceptableRoster(a.records);
    const check = new Y.Doc();
    applyRoster(check, records);
    const state = await readShare(check, a.space, a.account, memoryPins());
    const me = state?.members.get(fp);
    if (!state || !me || !sameKey(me.key, key)) throw new Error('The approval did not check out. Ask for a new link.');
    this.setJoin({ phase: 'adding' });
    const account = d.state.doc;
    if (readSpaces(account).some((s) => s.id === a.space)) setKeeps(account, d.me, a.space, true);
    else {
      const problem = addSpace(account, a.space, freeSpaceName(account, a.spaceName.slice(0, 60) || 'Shared', state.members.get(state.owner)?.name), undefined, d.me);
      if (problem) throw new Error(problem);
    }
    applyRoster(await d.store.open(spaceDocId(a.space)), records);
    setShareAnchor(account, a.space, a.account);
    noteSharedSince(account, a.space, a.account);
    await d.shares.settled();
    this.setJoin({ phase: 'done', spaceName: a.spaceName });
  }

  /** Stop trusting a share on every device of this account (leaving). */
  async leave(space: string): Promise<void> {
    await this.d().shares.leave(space);
  }
}

/** One per page; `main.tsx` configures it. */
export const shareLinks = new ShareLinks();
