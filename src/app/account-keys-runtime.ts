import type * as Y from 'yjs';
import { STORAGE_PREFIX } from '../constants';
import { readSpaces, spacesMap } from '../core/account';
import { keysMap, publishAccountKey, publishDeviceKeys, readDeviceKey, unsealAccountKey, type DeviceKeyRecord } from '../core/account-keys';
import { type ChoicePin, type LocalAccountKeys, type SettleEnv, sealAccount, settleAccount } from '../core/account-move';
import { certifyDevice, requireKeys, type DeviceCert } from '../core/key-certs';
import { removeDevices } from '../core/key-removals';
import { WrongPassphraseError } from '../core/crypto';
import { devicesMap, isLeft, isRemoved, readDevices, setDeviceName, setRemoved } from '../core/devices';
import { keepsMap } from '../core/keeps';
import type { NewAccountKey, StorageLike } from '../core/account-setup';
import type { EventBus } from '../core/bus';
import type { DocumentStore } from '../core/doc-store';
import { testMode } from '../core/test-build';
import { moveDeviceKey } from '../backup/encryption-state';
import { dropLocalAccountKey, dropOwnDeviceKeys, localAccountKey, ownDeviceKeys, saveLocalAccountKey } from '../sync/key-store';
import { fingerprint, generateAccountKey, isPublicKeyJwk } from '../core/keys';
import type { SyncService } from '../sync/sync-service';
import type { AccountState } from './account-state';
import { applyTrust, computeTrust, KeyTrust } from './key-trust';
import { UnlockWindow } from './unlock-window';

export { KeyTrust } from './key-trust';

/**
 * Keys in the running app (docs/sync.md, "Key model", slice 1, compatible mode): the account key,
 * this device's public keys, and sealing the account key with the passphrase. Nothing here changes
 * who may sync; older builds ignore all of it.
 */

const localKeys: LocalAccountKeys = { get: localAccountKey, save: saveLocalAccountKey, drop: dropLocalAccountKey };

/** Set when a peer has sent this device the account document since the update; until then a paired device makes no account key. */
const SYNCED_KEY = `${STORAGE_PREFIX}-account-synced`;
/** The account key this device follows, outside the document (#256): a write to `keys.chosen` alone cannot move it. */
const CHOSEN_KEY = `${STORAGE_PREFIX}-account-chosen`;

/**
 * Local keys of mechanisms dropped in #295 (the epoch pin, old mesh secrets, catch-up times, the
 * established space keys): emptied on start, since one holds old sync secrets.
 */
const DROPPED_KEYS = ['account-epochs', 'mesh-secrets', 'epoch-seen', 'space-keys'].map((k) => `${STORAGE_PREFIX}-${k}`);

export function clearDroppedKeys(storage: StorageLike): void {
  for (const k of DROPPED_KEYS) if (storage.getItem(k)) storage.setItem(k, '');
}

export function choicePin(storage: StorageLike): ChoicePin {
  return {
    get() {
      try {
        const v = JSON.parse(storage.getItem(CHOSEN_KEY) ?? 'null') as { fingerprint?: unknown; sealed?: unknown; ids?: unknown; publicKey?: unknown; by?: unknown; provisional?: unknown } | null;
        // A pin still provisional from a build before #295 (S-76s): follow the document's choice once, which writes a firm pin.
        if (!v || typeof v.fingerprint !== 'string' || !Array.isArray(v.ids) || v.provisional === true) return undefined;
        return {
          fingerprint: v.fingerprint,
          sealed: v.sealed === true,
          ids: v.ids.filter((x): x is string => typeof x === 'string'),
          ...(isPublicKeyJwk(v.publicKey) ? { publicKey: v.publicKey } : {}),
          ...(typeof v.by === 'string' ? { by: v.by } : {}),
        };
      } catch {
        return undefined;
      }
    },
    set(p) {
      storage.setItem(CHOSEN_KEY, JSON.stringify(p));
    },
  };
}

/** Browsers without IndexedDB or WebCrypto keep the account as it is. */
function available(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;
}

/** The key of a brand-new account, or undefined where the browser cannot make one (the account then starts with a random id and moves later). */
export function newAccountKey(me: string): NewAccountKey | undefined {
  if (!available()) return undefined;
  return async () => {
    const pair = await generateAccountKey();
    const fp = await fingerprint(pair.publicKey);
    await saveLocalAccountKey(fp, pair.privateKey);
    return { accountId: fp.slice(0, 24), publish: (doc) => publishAccountKey(doc, fp, pair.publicKey, me) };
  };
}

const env = (store: DocumentStore, storage: StorageLike, me: string, paired: boolean): SettleEnv => ({
  open: (d) => store.open(d),
  storage,
  keys: localKeys,
  me,
  paired,
  synced: storage.getItem(SYNCED_KEY) === '1',
  pin: choicePin(storage),
});

/** Before the app starts: make the account key and move to the account's fingerprint id. True when the id changed (open the account again). */
export async function settleOnStart(store: DocumentStore, storage: StorageLike, me: string, id: string, doc: Y.Doc, paired: boolean, log: (detail: string) => void): Promise<boolean> {
  if (!available()) return false;
  try {
    const r = await settleAccount(env(store, storage, me, paired), id, doc);
    if (r.refused) log(`ignored an unsigned change of the account key to ${r.refused.slice(0, 8)}`);
    if (r.status !== 'moved') return false;
    await moveDeviceKey(id, r.accountId);
    log(`account moved to ${r.accountId.slice(0, 8)}`);
    return true;
  } catch (e) {
    log(`account key setup failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** A peer sent this device the account document: a paired device may now make an account key if the account has none. */
export function markAccountSynced(storage: StorageLike): boolean {
  if (storage.getItem(SYNCED_KEY) === '1') return false;
  storage.setItem(SYNCED_KEY, '1');
  return true;
}

/** One per page: `main.tsx` hands it to sync before the account is known. */
export const keyTrust = new KeyTrust();


export interface AccountKeys {
  /** Run the check again (a peer's account document arrived). */
  kick(): void;
  /**
   * The passphrase was just typed on this device: seal the account key with it. The sealing key comes
   * from the passphrase and is not stored, so a device that has the backup key cannot do this alone.
   */
  passphraseTyped(passphrase: string): Promise<void>;
  /** Owner actions (#257) need the account key: unlocked by the passphrase for a few minutes. */
  unlocked(): boolean;
  /** Milliseconds the account key stays unlocked if nothing uses it (0: locked); each use of the key restarts it. */
  unlockedLeft(): number;
  /** Unlock the account key with the passphrase. `none`: the account has no protected key to unlock. */
  unlock(passphrase: string): Promise<'ok' | 'wrong' | 'none'>;
  /** The one-way switch: approve these devices (this one always) and require keys. Needs the key unlocked. */
  requireKeys(approved: readonly string[]): Promise<void>;
  /**
   * Approve a device: a known one (its keys are in the account document), or a new one from an
   * invite with its keys and name. Returns the signed records the new device needs to join.
   */
  approve(deviceId: string, join?: { keys: Pick<DeviceKeyRecord, 'sign' | 'agree' | 'v'>; name?: string }): Promise<[string, unknown][]>;
  /**
   * Remove a device (keys required, #258): the account key signs its removal, so no device links to
   * it or sends it anything new (S-258g). Needs the key unlocked. It keeps what it has.
   */
  removeDevice(deviceId: string): Promise<void>;
  /** Run a job with the unlocked account key and its fingerprint (the owner signs a share's records with it, #259). Needs the key unlocked. */
  signing<T>(job: (o: { fp: string; key: CryptoKey }) => Promise<T>): Promise<T>;
  /** Test builds: sign "keys required" with the account key this device holds or unlocked. False when it has none. */
  requireKeysForTest?(): Promise<boolean>;
}

const locked = (): Promise<never> => Promise.reject(new Error('Enter your passphrase first.'));

/** Where the browser cannot hold keys: nothing to do, owner actions refuse. */
export const NO_ACCOUNT_KEYS: AccountKeys = {
  kick() {},
  passphraseTyped: async () => {},
  unlocked: () => false,
  unlockedLeft: () => 0,
  unlock: async () => 'none',
  requireKeys: locked,
  approve: locked,
  removeDevice: locked,
  signing: locked,
};

/** The running app's account keys, for pages that offer owner actions (Devices). Set by `main.tsx`. */
export const ownerKeys: { current: AccountKeys } = { current: NO_ACCOUNT_KEYS };

/** While running: publish this device's keys, follow the account's chosen key, and keep certificates and space keys. */
export function startAccountKeys(o: { store: DocumentStore; storage: StorageLike; me: string; sync: SyncService; bus: EventBus; state: AccountState; log: (detail: string) => void; trust?: KeyTrust }): AccountKeys {
  if (!available()) return NO_ACCOUNT_KEYS;
  const { state } = o;
  const trust = o.trust ?? keyTrust;
  const pin = choicePin(o.storage);
  clearDroppedKeys(o.storage);
  let waiting: (() => void) | undefined;
  const lockTimer = new UnlockWindow();
  let refused: string | undefined;

  /** Looking at the key (background work) does not keep it unlocked; `ownerKey` below, used by an action, does. */
  const unlockedKey = (fp: string): CryptoKey | undefined => lockTimer.peek(fp);
  /** The account private key, when this device holds it (its creator, before sealing) or the passphrase unlocked it. */
  const accountKey = async (fp: string): Promise<CryptoKey | undefined> => unlockedKey(fp) ?? localAccountKey(fp);

  /** What the last refresh was computed from: the same inputs again (a device renamed, say) need no work. */
  let lastInputs = '';

  const refreshTrust = async (): Promise<void> => {
    const p = pin.get();
    const fp = p && p.ids.includes(state.id) ? p.fingerprint : undefined;
    const doc = state.doc;
    const own = await ownDeviceKeys();
    const key = fp ? await accountKey(fp) : undefined;
    const devices = readDevices(doc);
    const inputs = JSON.stringify([
      fp,
      !!key,
      own?.publicKeys.sign.x,
      keysMap(doc).toJSON(),
      keepsMap(doc).toJSON(),
      readSpaces(doc).map((sp) => sp.id),
      [...devices].filter(([, d]) => d.removed || d.left).map(([id]) => id),
    ]);
    if (inputs === lastInputs) return;
    const r = await computeTrust({ doc, fp, me: o.me, own, holder: key, owner: fp ? unlockedKey(fp) : undefined, log: o.log });
    // The account key removed this device: stop syncing and drop the removed keys, so a new invite can approve fresh ones (S-258g).
    if (r.removedSelf && o.sync.status.paired) {
      o.log('this device was removed from the account: stopped syncing; join again with a new invite');
      o.sync.unpair();
      await dropOwnDeviceKeys();
    }
    // Our own writes above change the document; the next run sees them as inputs and is a no-op unless they matter.
    lastInputs = inputs;
    if (applyTrust(trust, fp, r)) {
      o.log(`device keys: ${r.proof ? 'certified' : 'no certificate'}, ${r.certs.size} certified device(s)${r.required ? ', keys required' : ''}`);
      o.sync.keysChanged();
      trust.changed();
    }
  };

  const run = async (): Promise<void> => {
    const own = await ownDeviceKeys();
    if (own) publishDeviceKeys(state.doc, o.me, own.publicKeys);
    const r = await settleAccount(env(o.store, o.storage, o.me, o.sync.status.paired), state.id, state.doc);
    if (r.refused && r.refused !== refused) o.log(`ignored an unsigned change of the account key to ${r.refused.slice(0, 8)}`);
    refused = r.refused;
    if (r.status === 'moved') {
      await moveDeviceKey(state.id, r.accountId);
      o.log(`following account key ${r.accountId.slice(0, 8)}; reloading`);
      setTimeout(() => location.reload(), 800);
      return;
    } else if (r.status === 'waiting' && !waiting) {
      // Waiting for the account's data from a peer: try again once, when it arrives.
      waiting = (): void => {
        spacesMap(state.doc).unobserve(waiting as () => void);
        waiting = undefined;
        kick();
      };
      spacesMap(state.doc).observe(waiting);
    }
    await refreshTrust();
  };
  let running: Promise<void> = Promise.resolve();
  const queue = (job: () => Promise<void>): void => {
    running = running.then(job).catch((e: unknown) => o.log(`keys: ${e instanceof Error ? e.message : String(e)}`));
  };
  // Many changes in a row (a burst of grants, a catch-up) need one run, not one each.
  let queued = false;
  const kick = (): void => {
    if (queued) return;
    queued = true;
    queue(async () => {
      queued = false;
      await run();
    });
  };
  /** Run a job in the queue and hand back its result (owner actions report errors to the page). */
  const inQueue = <T>(job: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue(async () => {
        try {
          resolve(await job());
        } catch (e) {
          reject(e);
        }
      });
    });
  /** The unlocked account key, or an error the page shows. Called from queued jobs, so it never waits for the queue. */
  const ownerKey = async (): Promise<{ fp: string; key: CryptoKey }> => {
    const fp = trust.accountFp;
    const key = fp ? lockTimer.use(fp) : undefined;
    if (!fp || !key) throw new Error('Enter your passphrase first.');
    return { fp, key };
  };
  const refreshNow = async (): Promise<void> => {
    lastInputs = '';
    await refreshTrust();
  };

  kick();
  keysMap(state.doc).observe(kick);
  devicesMap(state.doc).observe(kick);
  keepsMap(state.doc).observe(kick);
  spacesMap(state.doc).observe(kick);
  return {
    kick,
    passphraseTyped: (passphrase) =>
      inQueue(async () => {
        const e = env(o.store, o.storage, o.me, o.sync.status.paired);
        const what = await sealAccount(e, state.doc, passphrase, testMode() ? 1000 : undefined);
        if (what !== 'none') o.log(`account key ${what}`);
        const fp = pin.get()?.fingerprint;
        const key = fp ? await unsealAccountKey(state.doc, fp, passphrase).catch(() => undefined) : undefined;
        if (fp && key) lockTimer.set(fp, key);
        await refreshTrust();
      }),
    unlocked: () => {
      const fp = trust.accountFp ?? pin.get()?.fingerprint;
      return !!fp && !!unlockedKey(fp);
    },
    unlockedLeft: () => {
      const fp = trust.accountFp ?? pin.get()?.fingerprint;
      return fp ? lockTimer.left(fp) : 0;
    },
    unlock: (passphrase) =>
      inQueue(async () => {
        const fp = pin.get()?.fingerprint;
        if (!fp) return 'none';
        try {
          const key = await unsealAccountKey(state.doc, fp, passphrase);
          if (!key) return 'none';
          lockTimer.set(fp, key);
        } catch (e) {
          if (e instanceof WrongPassphraseError) return 'wrong';
          throw e;
        }
        await refreshNow();
        return 'ok';
      }),
    requireKeys: (approved) =>
      inQueue(async () => {
        const { fp, key } = await ownerKey();
        const ids = [...new Set([o.me, ...approved])];
        const records = ids.map((id) => readDeviceKey(state.doc, id)).filter((r): r is DeviceKeyRecord => !!r && !isRemoved(state.doc, r.deviceId) && !isLeft(state.doc, r.deviceId));
        if (!records.some((r) => r.deviceId === o.me)) throw new Error('This device has no keys yet.');
        await requireKeys(state.doc, fp, key, records, o.me);
        o.log(`keys required; ${records.length} device(s) approved`);
        await refreshNow();
      }),
    approve: (deviceId, join) =>
      inQueue(async () => {
        const { fp, key } = await ownerKey();
        const doc = state.doc;
        if (join) {
          publishDeviceKeys(doc, deviceId, join.keys, join.keys.v ?? 0);
          if (join.name) setDeviceName(doc, deviceId, join.name);
        }
        const rec = readDeviceKey(doc, deviceId);
        if (!rec) throw new Error('That device has no keys yet.');
        await certifyDevice(doc, fp, key, deviceId, rec, true);
        o.log(`approved ${deviceId.slice(0, 8)}`);
        await refreshNow();
        const m = keysMap(doc);
        const names = [`account:${fp}`, `sealed:${fp}`, 'chosen', 'required', `cert:${deviceId}`, `device:${deviceId}`, `cert:${o.me}`, `device:${o.me}`];
        return names.filter((n) => m.has(n)).map((n) => [n, JSON.parse(JSON.stringify(m.get(n))) as unknown] as [string, unknown]);
      }),
    signing: (job) => inQueue(async () => job(await ownerKey())),
    removeDevice: (deviceId) =>
      inQueue(async () => {
        const { fp, key } = await ownerKey();
        if (!trust.required()) throw new Error('Removing with the passphrase is for accounts that require device keys.');
        if (deviceId === o.me) throw new Error('This device cannot remove itself; use Leave.');
        const rec = readDeviceKey(state.doc, deviceId);
        const cert: DeviceCert | undefined = trust.certs.get(deviceId) ?? (rec ? { deviceId, account: fp, sign: rec.sign, agree: rec.agree, v: 2 } : undefined);
        if (!cert) {
          // No keys at all: it never had access; mark it as before.
          setRemoved(state.doc, deviceId, true);
          return;
        }
        await removeDevices(state.doc, fp, key, [cert]);
        o.log(`removed ${deviceId.slice(0, 8)}`);
        await refreshNow();
      }),
    ...(testMode()
      ? {
          requireKeysForTest: async () => {
            await running;
            const fp = trust.accountFp;
            const key = fp ? await accountKey(fp) : undefined;
            if (!fp || !key) return false;
            // The switch, approving every device certified now (the review is the page's job).
            await requireKeys(state.doc, fp, key, [...trust.certs.keys()].map((id) => readDeviceKey(state.doc, id)).filter((r): r is DeviceKeyRecord => !!r), o.me);
            await refreshNow();
            return true;
          },
        }
      : {}),
  };
}
