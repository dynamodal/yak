import type * as Y from 'yjs';
import { accountDocId, spacesMap } from '../../src/core/account';
import { chosenFingerprint, keysMap, KEYS_REQUIRED_LEVEL, publishDeviceKeys, readAccountKeys } from '../../src/core/account-keys';
import { decodeText } from '../../src/core/bytes';
import { devicesMap, deviceName } from '../../src/core/devices';
import { keepsMap } from '../../src/core/keeps';
import { checkApproval, checkChosen, type PinnedChoice } from '../../src/core/key-certs';
import { exportDeviceKeys, generateDeviceKeys, importDeviceKeys, unwrap, type DeviceKeyPairs, type DeviceKeysJwk } from '../../src/core/keys';
import { kvDb } from '../../src/core/kv-db';
import type { DocumentStore } from '../../src/core/doc-store';
import { applyTrust, computeTrust, KeyTrust } from '../../src/app/key-trust';
import { InviteGuest, type Approval } from '../../src/sync/invite';
import { ownDeviceKeys } from '../../src/sync/key-store';
import type { SyncService } from '../../src/sync/sync-service';
import { createTransport } from '../../src/sync/transport-factory';

/**
 * Device keys for the vault (docs/sync.md, Key model, S-76p, #257): the vault is a
 * device like any other, with its own key pair, approved by an owner's device. Keys live in
 * protected browser key storage (non-extractable keys in IndexedDB) when there is one, else in the
 * plugin's settings file, which vault sync can copy; the settings tab says which.
 */

/** Where this vault's private keys are kept. */
export type KeyStorage = 'protected' | 'settings';

export interface KeyData {
  /** The private keys, only when protected storage is not available. */
  keys?: DeviceKeysJwk;
  /** The account key this vault follows, so a write to `keys.chosen` alone cannot move it (S-256d). */
  chosen?: PinnedChoice;
  /** Per space, the key this vault saw established: no longer read or written (#295). */
  spaceKeys?: Record<string, string>;
}

/** Load this vault's keys, making them on first use. Several vaults on one desktop share the browser storage, so the device id names them. */
export async function loadDeviceKeys(deviceId: string, data: KeyData): Promise<{ keys: DeviceKeyPairs; storage: KeyStorage } | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  if (data.keys) return { keys: await importDeviceKeys(data.keys), storage: 'settings' };
  if (typeof indexedDB !== 'undefined') {
    const db = kvDb('yak-sync-keys');
    const name = `device-keys:${deviceId}`;
    const keys = await ownDeviceKeys({ kvGet: (k) => db.kvGet(k === 'device-keys' ? name : k), kvSet: (k, v) => db.kvSet(k === 'device-keys' ? name : k, v) });
    if (keys) return { keys, storage: 'protected' };
  }
  const keys = await generateDeviceKeys(true);
  data.keys = await exportDeviceKeys(keys);
  return { keys, storage: 'settings' };
}

export interface JoinProgress {
  phase: 'asking' | 'compare' | 'approved' | 'declined' | 'failed';
  compare?: string;
  /** The person confirmed in Obsidian that the codes match. */
  confirmed?: boolean;
  error?: string;
}

/** The vault's keys while the plugin runs: publish them, follow the account's key, keep the trust sync reads. */
export class PluginKeys {
  readonly trust: KeyTrust;
  keys: DeviceKeyPairs | undefined;
  storage: KeyStorage | undefined;
  join: JoinProgress | undefined;
  private doc: Y.Doc | undefined;
  private running: Promise<void> = Promise.resolve();
  private queued = false;
  private guest: InviteGuest | undefined;
  private ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly o: { me: string; data: KeyData; save(): Promise<void>; sync: SyncService; store: DocumentStore; trust: KeyTrust; log(detail: string): void; onChange?(): void },
  ) {
    this.trust = o.trust;
  }

  start(): Promise<void> {
    this.ready = this.load();
    return this.ready;
  }

  private async load(): Promise<void> {
    const loaded = await loadDeviceKeys(this.o.me, this.o.data).catch((e: unknown) => {
      this.o.log(`device keys unavailable: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    });
    if (!loaded) return;
    this.keys = loaded.keys;
    this.storage = loaded.storage;
    if (loaded.storage === 'settings') await this.o.save();
    this.o.log(`device keys in ${loaded.storage === 'protected' ? 'protected browser storage' : 'the settings file'}`);
    if (this.doc) this.kick();
  }

  /** The account document arrived (or changed): follow it. */
  attach(doc: Y.Doc): void {
    if (this.doc === doc) return;
    this.doc = doc;
    const kick = (): void => this.kick();
    for (const m of [keysMap(doc), devicesMap(doc), keepsMap(doc), spacesMap(doc)]) m.observe(kick);
    this.kick();
  }

  private kick(): void {
    if (this.queued) return;
    this.queued = true;
    this.running = this.running
      .then(async () => {
        this.queued = false;
        await this.refresh();
      })
      .catch((e: unknown) => this.o.log(`keys: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async refresh(): Promise<void> {
    const doc = this.doc;
    if (!doc || !this.keys) return;
    publishDeviceKeys(doc, this.o.me, this.keys.publicKeys, KEYS_REQUIRED_LEVEL);
    // The pinned key, as the app does (S-256d): first sight is trusted, then the pin stays.
    const check = await checkChosen(doc, chosenFingerprint(doc), this.o.data.chosen);
    if (check.refused) this.o.log(`ignored an unsigned change of the account key to ${check.refused.slice(0, 8)}`);
    const fp = check.fingerprint;
    if (fp && fp !== this.o.data.chosen?.fingerprint) {
      const k = (await readAccountKeys(doc)).find((x) => x.fingerprint === fp);
      if (k) {
        this.o.data.chosen = { fingerprint: fp, sealed: k.sealed, publicKey: k.publicKey, by: k.by };
        await this.o.save();
      }
    }
    const r = await computeTrust({ doc, fp, me: this.o.me, own: this.keys, log: this.o.log });
    if (applyTrust(this.trust, fp, r)) {
      this.o.log(`device keys: ${r.proof ? 'approved' : 'not approved'}${r.required ? ', keys required' : ''}`);
      this.o.sync.keysChanged();
      this.o.onChange?.();
    }
  }

  private last: { code: string; relay: string; name: string } | undefined;

  /** Join with a code, and ask to be approved in case it is a one-time invite (#257). */
  async joinWithCode(code: string, relay: string, name: string): Promise<void> {
    await this.o.sync.join(code, relay);
    this.last = { code, relay, name };
    await this.ask();
  }

  /** The person saw the same code in Obsidian and in the app. */
  confirmJoin(): void {
    this.guest?.confirm();
    if (this.join?.phase === 'compare') this.setJoin({ ...this.join, confirmed: true });
  }

  /** The codes did not match: ask again from the start. */
  restartJoin(): Promise<void> {
    return this.ask();
  }

  private async ask(): Promise<void> {
    if (!this.last) return;
    const { code, relay, name: given } = this.last;
    await this.ready;
    const keys = this.keys;
    if (!keys) return;
    this.guest?.stop();
    this.setJoin({ phase: 'asking' });
    const name = (this.doc && deviceName(this.doc, this.o.me)) ?? given;
    const guest = new InviteGuest(code, createTransport(relay), { deviceId: this.o.me, name, ...keys.publicKeys, v: KEYS_REQUIRED_LEVEL }, {
      onSeen: (_a, _k, compare) => this.setJoin({ phase: 'compare', compare }),
      onApproved: (a) => void this.adopt(a, keys).catch((e: unknown) => this.setJoin({ phase: 'failed', error: e instanceof Error ? e.message : String(e) })),
      onDeclined: (why) => {
        this.o.sync.unpair();
        this.setJoin({ phase: 'declined', ...(why === 'used' ? { error: 'This code was already used. Make a new one in the app.' } : {}) });
      },
      onNoAnswer: () => {
        if (this.guest === guest && this.join?.phase === 'asking') {
          this.join = undefined;
          this.o.onChange?.();
        }
      },
    });
    this.guest = guest;
    await guest.start();
  }

  private setJoin(j: JoinProgress): void {
    this.join = j;
    this.o.onChange?.();
  }

  /** Approved: keep the signed records, follow the compared account key, move to the account's sync secret. */
  private async adopt(a: Approval, keys: DeviceKeyPairs): Promise<void> {
    const records = await checkApproval(a.records, a.account, this.o.me, keys.publicKeys);
    if (!records) throw new Error('The approval did not check out. Try again with a new code.');
    const secret = decodeText(await unwrap(keys.agree.privateKey, a.secret));
    const doc = await this.o.store.open(accountDocId(a.accountId));
    doc.transact(() => {
      for (const [k, v] of records) keysMap(doc).set(k, v);
    });
    const key = (await readAccountKeys(doc)).find((k) => k.fingerprint === a.account);
    if (key) this.o.data.chosen = { fingerprint: a.account, sealed: true, publicKey: key.publicKey, by: key.by };
    await this.o.save();
    await this.o.sync.adoptPairing(secret, a.signalingUrl, a.accountId);
    this.o.log(`approved into account ${a.accountId.slice(0, 8)}`);
    this.setJoin({ phase: 'approved' });
    this.kick();
  }
}
