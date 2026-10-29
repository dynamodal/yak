import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/bus';
import { MemoryStore } from '../core/history/memory-store';
import { MemoryDir, SubDir } from './dir';
import { openBackup } from './restore';
import { BackupService, DEFAULT_STALE_HOURS, HOURLY_MS, STOP_DEBOUNCE_MS, backupHealth, type BackupState, type FolderInfo, type StoredStatus } from './service';
import { listBackups } from './store';
import { addEntry, memoryStore, seedSpace } from './testing';

async function setup(folderState: FolderInfo['state'] = 'granted') {
  const store = memoryStore();
  const doc = await store.open('space/personal');
  seedSpace(doc, 'S');
  const root = new MemoryDir();
  const segments = new MemoryStore();
  const folder = { state: folderState, id: 'folder-1', name: 'Backups' };
  let saved: StoredStatus = {};
  const service = new BackupService({
    docs: () => store.opened(),
    deviceId: 'cccc0000-1111',
    accountId: 'acct1',
    history: segments,
    folder: { current: async () => ({ ...folder, dir: folder.state === 'granted' ? root : undefined }) },
    status: { load: () => saved, save: (s) => (saved = s) },
  });
  return { store, doc, root, folder, service, saved: () => saved };
}

/** Restore points: the full backups of the account folder. */
const points = (root: MemoryDir) => new SubDir(root, 'acct1/restore-points');
const count = async (root: MemoryDir) => (await listBackups(points(root))).total;

describe('BackupService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('writes a verified backup and records it on this device', async () => {
    const { root, service, saved } = await setup();
    const r = await service.run('manual', { force: true });
    expect(r.status).toBe('written');
    const { items } = await listBackups(points(root));
    expect(items).toHaveLength(1);
    expect((await openBackup(new SubDir(points(root), items[0]?.name as string))).verification.ok).toBe(true);
    expect(saved()).toMatchObject({ lastBackupName: items[0]?.name, lastReason: 'manual', lastFolderId: 'folder-1' });
  });

  it('skips automatic runs when nothing changed, but "Back up now" always writes', async () => {
    const { root, doc, service, saved } = await setup();
    await service.run('hourly');
    expect(await service.run('hourly')).toEqual({ status: 'unchanged' });
    expect(saved().lastCheckedAt).toBeDefined();
    expect(await count(root)).toBe(1);
    const before = saved().lastBackupName;
    expect((await service.run('manual', { force: true })).status).toBe('written');
    expect(saved().lastBackupName).not.toBe(before);
    // A restore point per week: the second one of the week replaces the first.
    expect(await count(root)).toBe(1);
    addEntry(doc, '2026-10-15T11:00:00Z', '2026-10-15T11:30:00Z', 'new');
    expect((await service.run('hourly')).status).toBe('written');
    expect(await count(root)).toBe(1);
    expect(new TextDecoder().decode(root.files.get('acct1/current/docs/space~personal/time_entries/2026-10.jsonl'))).toContain('new');
  });

  it('writes again when the last backup folder disappeared or another folder was chosen', async () => {
    const { root, folder, service } = await setup();
    const first = await service.run('hourly');
    if (first.status !== 'written') throw new Error('expected a backup');
    for (const k of [...root.files.keys()]) if (k.startsWith('acct1/current/')) root.files.delete(k);
    expect((await service.run('hourly')).status).toBe('written');
    folder.id = 'folder-2';
    expect((await service.run('hourly')).status).toBe('written');
  });

  it('never runs two backups at once and merges requests made meanwhile into one follow-up', async () => {
    const { root, doc, service } = await setup();
    let active = 0;
    let maxActive = 0;
    let changed = false;
    const write = root.writeFile.bind(root);
    root.writeFile = async (p, d) => {
      active++;
      maxActive = Math.max(maxActive, active);
      // A change while the first run writes: its snapshot is already taken, so a follow-up must catch it.
      if (!changed) {
        changed = true;
        addEntry(doc, '2026-10-15T11:00:00Z', '2026-10-15T11:30:00Z', 'during the first run');
      }
      await Promise.resolve();
      active--;
      return write(p, d);
    };
    const a = service.run('manual', { force: true });
    const b = service.run('timer-stopped');
    const c = service.run('hourly');
    expect(b).toBe(c);
    const results = await Promise.all([a, b, c]);
    expect(results.map((r) => r.status)).toEqual(['written', 'written', 'written']);
    expect(maxActive).toBe(1);
    expect(await count(root)).toBe(1);
    expect(new TextDecoder().decode(root.files.get('acct1/current/docs/space~personal/time_entries/2026-10.jsonl'))).toContain('during the first run');
  });

  it('backs up once, a few seconds after timers stop, and every hour while open', async () => {
    const { root, doc, service } = await setup();
    let writes = 0;
    const write = root.writeFile.bind(root);
    root.writeFile = async (p, d) => {
      if (p === 'acct1/current/manifest.json') writes++;
      return write(p, d);
    };
    const bus = new EventBus();
    service.setStaleAfterHours(DEFAULT_STALE_HOURS);
    const stop = service.start(bus);
    await vi.advanceTimersByTimeAsync(20_000); // startup check: no backup yet, so one is made
    await service.whenIdle();
    expect(writes).toBe(1);

    addEntry(doc, '2026-10-15T11:00:00Z', '2026-10-15T11:30:00Z', 'a');
    bus.emit('timer:stopped', { spaceId: 'personal', entryId: 'x' });
    await vi.advanceTimersByTimeAsync(STOP_DEBOUNCE_MS / 2);
    bus.emit('timer:stopped', { spaceId: 'personal', entryId: 'y' });
    await vi.advanceTimersByTimeAsync(STOP_DEBOUNCE_MS / 2);
    await service.whenIdle();
    expect(writes).toBe(1);
    await vi.advanceTimersByTimeAsync(STOP_DEBOUNCE_MS);
    await service.whenIdle();
    expect(writes).toBe(2);

    addEntry(doc, '2026-10-15T12:00:00Z', '2026-10-15T12:30:00Z', 'b');
    await vi.advanceTimersByTimeAsync(HOURLY_MS);
    await service.whenIdle();
    expect(writes).toBe(3);
    await vi.advanceTimersByTimeAsync(HOURLY_MS); // nothing changed: checked, not written
    await service.whenIdle();
    expect(writes).toBe(3);
    stop();
  });

  it('does nothing without a granted folder and reports the folder state', async () => {
    const { root, service } = await setup('prompt');
    const r = await service.run('hourly');
    expect(r).toMatchObject({ status: 'no-folder', folder: { state: 'prompt' } });
    expect(root.files.size).toBe(0);
    expect(service.state.folder.state).toBe('prompt');
  });

  it('records a failed write so the banner can say so', async () => {
    const { root, service, saved } = await setup();
    root.writeFile = async () => {
      throw new Error('disk full');
    };
    expect(await service.run('manual', { force: true })).toEqual({ status: 'failed', error: 'disk full' });
    expect(saved()).toMatchObject({ lastError: 'disk full' });
    expect(service.state.running).toBe(false);
  });

  it('gives up an automatic run while another tab holds the lock', async () => {
    const { service } = await setup();
    const busy = new BackupService({
      ...(service as unknown as { opts: ConstructorParameters<typeof BackupService>[0] }).opts,
      lock: async (fn, wait) => (wait ? fn() : 'busy'),
    });
    expect(await busy.run('hourly')).toEqual({ status: 'busy' });
    expect((await busy.run('manual', { force: true })).status).toBe('written');
  });

  it('makes a downloadable single-file backup and counts it as a backup', async () => {
    const { service } = await setup('unsupported');
    const d = await service.downloadable();
    expect(d.fileName).toMatch(/^backup-2026-10-15T12-00-00-000Z_cccc0000\.json$/);
    expect(JSON.parse(d.text).format).toBe('backup-bundle');
    expect(service.lastGoodAt()).toBe(Date.parse('2026-10-15T12:00:00Z'));
  });
});

describe('BackupService cover records (#83)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  async function withSink() {
    const store = memoryStore();
    seedSpace(await store.open('space/personal'), 'S');
    const events: { kind: string; at: string; ids: string[] }[] = [];
    let saved: StoredStatus = {};
    const dir = new MemoryDir();
    const service = new BackupService({
      docs: () => store.opened(),
      deviceId: 'cccc0000-1111',
      accountId: 'acct1',
      folder: { current: async () => ({ state: 'granted' as const, id: 'f', name: 'B', dir }) },
      status: { load: () => saved, save: (x) => (saved = x) },
      onBackup: (e) => events.push({ kind: e.kind, at: e.at, ids: e.documents.map((d) => d.id) }),
    });
    return { service, events, saved: () => saved };
  }

  it('tells after a folder backup and after a download', async () => {
    const { service, events } = await withSink();
    await service.run('manual', { force: true });
    expect(events).toEqual([{ kind: 'folder', at: '2026-10-15T12:00:00.000Z', ids: ['space/personal'] }]);
    await service.downloadable();
    expect(events.map((e) => e.kind)).toEqual(['folder', 'download']);
  });

  it('tells again from an unchanged check only once the last telling is 3 hours old', async () => {
    const { service, events } = await withSink();
    await service.run('hourly');
    vi.setSystemTime(new Date('2026-10-15T13:00:00Z'));
    expect((await service.run('hourly')).status).toBe('unchanged');
    expect(events).toHaveLength(1);
    vi.setSystemTime(new Date('2026-10-15T15:30:00Z'));
    expect((await service.run('hourly')).status).toBe('unchanged');
    expect(events).toHaveLength(2);
  });
});

describe('backupHealth', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const s = (patch: Partial<BackupState>): BackupState => ({ folder: { state: 'granted', name: 'B' }, running: false, ...patch });
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

  it('is fine with a recent backup or a recent unchanged check', () => {
    expect(backupHealth(s({ lastBackupAt: hoursAgo(2) }), now, true)).toMatchObject({ ok: true, text: 'Backed up 2 hours ago.' });
    expect(backupHealth(s({ lastBackupAt: hoursAgo(50), lastCheckedAt: hoursAgo(1) }), now, true).ok).toBe(true);
  });

  it('warns when the last backup is older than the threshold', () => {
    expect(backupHealth(s({ lastBackupAt: hoursAgo(25) }), now, true)).toMatchObject({ ok: false, kind: 'stale' });
    expect(backupHealth(s({ lastBackupAt: hoursAgo(25), staleAfterHours: 72 }), now, true).ok).toBe(true);
    expect(backupHealth(s({ lastBackupAt: hoursAgo(24 * 3) }), now, true).text).toBe('The last backup was 3 days ago.');
  });

  it('warns when folder access was lost or needs permission again', () => {
    expect(backupHealth(s({ folder: { state: 'prompt', name: 'B' }, lastBackupAt: hoursAgo(1) }), now, true).kind).toBe('permission');
    expect(backupHealth(s({ folder: { state: 'error', name: 'B' }, lastBackupAt: hoursAgo(1) }), now, true).kind).toBe('lost');
  });

  it('warns about a failed last run and about data that was never backed up', () => {
    expect(backupHealth(s({ lastBackupAt: hoursAgo(3), lastErrorAt: hoursAgo(1), lastError: 'x' }), now, true).kind).toBe('failed');
    expect(backupHealth(s({ lastBackupAt: hoursAgo(1), lastErrorAt: hoursAgo(3) }), now, true).ok).toBe(true);
    expect(backupHealth(s({ folder: { state: 'none' } }), now, true)).toMatchObject({ ok: false, kind: 'never' });
    expect(backupHealth(s({ folder: { state: 'unsupported' } }), now, true).text).toMatch(/Download a backup/);
    expect(backupHealth(s({ folder: { state: 'none' } }), now, false).ok).toBe(true);
  });
});
