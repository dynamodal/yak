import * as Y from 'yjs';
import { SubDir } from './dir';
import { base64, unbase64 } from './format';
import { readAllFiles } from './restore';
import { RESTORE_POINTS } from './incremental';
import { listBackups, readManifest } from './store';
import type { BackupRuntime } from './runtime';
import { friendlyDocId, testDocId } from '../core/test-ids';
import { isLogDoc } from '../core/doc-store';
import { addEntry, seedSpace } from './testing';

const MAPS = ['time_entries', 'projects', 'clients', 'tags', 'notes', 'settings', 'meta', 'keys'];

/** Plain JSON of the known root types and the state vector of every open document. */
function dump(rt: BackupRuntime): Record<string, { maps: Record<string, unknown>; text: string; sv: [number, number][] }> {
  const out: Record<string, { maps: Record<string, unknown>; text: string; sv: [number, number][] }> = {};
  for (const [id, doc] of rt.store.opened()) {
    if (isLogDoc(id)) continue;
    const maps: Record<string, unknown> = {};
    for (const name of MAPS) maps[name] = doc.getMap(name).toJSON();
    out[friendlyDocId(rt.store, id)] = { maps, text: doc.getText('t').toString(), sv: [...Y.decodeStateVector(Y.encodeStateVector(doc))].sort((a, b) => a[0] - b[0]) };
  }
  return out;
}

/** Only with `?test` in the URL: lets the browser e2e drive backups against the Origin Private File System. */
export function installTestHook(rt: BackupRuntime): void {
  const space = (id: string): Y.Doc => {
    const doc = rt.store.get(testDocId(rt.store, `space/${id}`));
    if (!doc) throw new Error(`space ${id} not open`);
    return doc;
  };
  const time = (id: string): Y.Doc => {
    const doc = rt.store.get(testDocId(rt.store, `space/${id}/time`));
    if (!doc) throw new Error(`time document of ${id} not open`);
    return doc;
  };
  const dir = async () => {
    const f = await rt.folder.current();
    if (!f.dir) throw new Error(`no folder: ${f.state}`);
    return f.dir;
  };
  (window as unknown as { __backup: unknown }).__backup = {
    ready: () => rt.ready,
    useOpfs: async (name: string) => {
      await rt.folder.useOriginPrivate(name);
      return rt.service.refreshFolder();
    },
    seed: (spaceId: string, label: string) => seedSpace(space(spaceId), label, time(spaceId)),
    addEntry: (spaceId: string, description: string) => addEntry(time(spaceId), '2026-10-15T13:00:00Z', '2026-10-15T13:30:00Z', description),
    stopped: () => rt.bus.emit('timer:stopped', { spaceId: 'personal', entryId: 'test' }),
    idle: () => rt.service.whenIdle(),
    run: () => rt.service.run('manual', { force: true }).then((r) => r.status),
    state: () => rt.service.state,
    dump: () => dump(rt),
    /** Forget the sealed account key, as an account that set its passphrase before the update (#255). */
    unsealForTest: () => {
      for (const [id, doc] of rt.store.opened()) if (/^account\/[a-f0-9]{24}$/.test(id)) for (const k of [...doc.getMap('keys').keys()]) if (k.startsWith('sealed:')) doc.getMap('keys').delete(k);
    },
    /** As if the account key had been made by another device that was then removed (the case a passphrase may replace, S-76s). */
    orphanKeyForTest: () => {
      for (const [id, doc] of rt.store.opened()) {
        if (!/^account\/[a-f0-9]{24}$/.test(id)) continue;
        const keys = doc.getMap<{ by?: string }>('keys');
        for (const [k, v] of [...keys.entries()]) if (k.startsWith('account:')) keys.set(k, { ...v, by: 'gone-device' });
        doc.getMap('devices').set('gone-device:removed', true);
      }
    },
    /** Restore points of this account, then full backups made directly in the folder. */
    list: async () => {
      const root = await dir();
      const points = await listBackups(new SubDir(root, `${rt.accountId}/${RESTORE_POINTS}`));
      const older = await listBackups(root);
      return [...points.items.map((i) => ({ ...i, path: `${rt.accountId}/${RESTORE_POINTS}/${i.name}` })), ...older.items].map((i) => ({ name: i.name, path: i.path ?? i.name, error: i.error, counts: i.manifest?.counts }));
    },
    /** The name of the readable mirror's latest state. */
    currentName: async () => (await readManifest(new SubDir(await dir(), `${rt.accountId}/current`))).name,
    /** Every history segment file in the folder, as paths. */
    segmentFiles: async () => {
      const root = await dir();
      const acct = new SubDir(root, rt.accountId);
      const out: string[] = [];
      for (const d of await acct.listDirs('history')) for (const f of await acct.listFiles(`history/${d}`)) out.push(`history/${d}/${f}`);
      return out.sort();
    },
    /** The account folder's index, history segments and restore points as base64, to copy into another profile. */
    exportAccount: async () => {
      const root = await dir();
      const out: Record<string, string> = {};
      const walk = async (path: string): Promise<void> => {
        const d = new SubDir(root, path);
        for (const f of await d.listFiles('')) out[`${path}/${f}`] = base64(await d.readFile(f));
        for (const sub of await d.listDirs('')) await walk(`${path}/${sub}`);
      };
      await walk(rt.accountId);
      return out;
    },
    importAccount: async (files: Record<string, string>) => {
      const d = await dir();
      for (const [p, b] of Object.entries(files)) await d.writeFile(p, unbase64(b));
    },
    flushHistory: async () => (window as unknown as { __history?: { flush(): Promise<unknown> } }).__history?.flush(),
    accountId: () => rt.accountId,
    /** Whether the readable mirror's manifest is stored encrypted, and whether any readable export remains. */
    encryptedState: async () => {
      const root = await dir();
      const head = new TextDecoder('latin1').decode((await root.readFile(`${rt.accountId}/current/manifest.json`)).subarray(0, 6));
      const acct = new SubDir(root, `${rt.accountId}/current/docs`);
      let readable = 0;
      for (const d of await acct.listDirs('')) for (const sub of await acct.listDirs(d)) readable += (await acct.listFiles(`${d}/${sub}`)).length;
      return { header: head, readable };
    },
    /** All files of one backup (manifest included), base64, to copy it into another profile. */
    exportFolder: async (name: string) => {
      const d = new SubDir(await dir(), name);
      const files = await readAllFiles(d, await readManifest(d));
      const out: Record<string, string> = { 'manifest.json': base64(await d.readFile('manifest.json')) };
      for (const [p, b] of files) out[p] = base64(b);
      return out;
    },
    importFolder: async (name: string, files: Record<string, string>) => {
      const d = await dir();
      for (const [p, b] of Object.entries(files)) await d.writeFile(`${name}/${p}`, unbase64(b));
    },
    /** Flip one byte of a file in a backup, to check that restore refuses it. */
    corrupt: async (name: string, path: string) => {
      const d = await dir();
      const bytes = await d.readFile(`${name}/${path}`);
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      await d.writeFile(`${name}/${path}`, bytes);
    },
  };
}
