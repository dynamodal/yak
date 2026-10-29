import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { base64 } from './format';
import { backupHealth, type BackupState } from './service';
import { COVER_MAP, coverDocs, coverHealth, type CoverSummary, readCover, spaceCover, summarizeCover, vectorContains, writeCover, type CoverRecord, type SpaceInput } from './cover';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const H = 3_600_000;
const LIMIT = 24 * H;
const ago = (h: number) => new Date(NOW - h * H).toISOString();

/** A document edited by two devices, so its vector has two clients. */
function docs() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.getMap('m').set('x', 1);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  b.getMap('m').set('y', 2);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  return { a, b };
}
const sv = (d: Y.Doc) => base64(Y.encodeStateVector(d));
const rec = (at: string, d: Record<string, Y.Doc>): CoverRecord => ({ at, kind: 'folder', encrypted: false, docs: Object.fromEntries(Object.entries(d).map(([id, doc]) => [id, sv(doc)])) });
const space = (local: Record<string, Y.Doc>, records: Record<string, CoverRecord>): SpaceInput => ({
  id: 's',
  name: 'Work',
  hasData: true,
  vectors: new Map(Object.entries(local).map(([id, d]) => [id, Y.encodeStateVector(d)])),
  records: new Map(Object.entries(records)),
});

describe('vectorContains', () => {
  it('needs every client of the local vector at or below the recorded clock', () => {
    expect(vectorContains(new Map([[1, 5], [2, 3]]), new Map([[1, 5], [2, 2]]))).toBe(true);
    expect(vectorContains(new Map([[1, 5]]), new Map([[1, 6]]))).toBe(false);
    expect(vectorContains(new Map([[1, 5]]), new Map([[1, 5], [2, 1]]))).toBe(false);
    expect(vectorContains(new Map(), new Map())).toBe(true);
  });
});

describe('spaceCover', () => {
  it('is covered by a recent record that holds the local state', () => {
    const { a } = docs();
    const c = spaceCover(space({ 'space/s': a }, { laptop: rec(ago(2), { 'space/s': a }) }), 'phone', NOW, LIMIT);
    expect(c).toMatchObject({ covered: true, waiting: false, by: { device: 'laptop' } });
  });

  it('is not covered once the local doc moved on; a recent record then means waiting', () => {
    const { a } = docs();
    const old = rec(ago(2), { 'space/s': a });
    a.getMap('m').set('z', 3);
    expect(spaceCover(space({ 'space/s': a }, { laptop: old }), 'phone', NOW, LIMIT)).toMatchObject({ covered: false, waiting: true });
  });

  it('ignores records outside the threshold, from this device, ahead of the clock, or from a device told to ignore', () => {
    const { a } = docs();
    const r = (at: string) => ({ laptop: rec(at, { 'space/s': a }) });
    expect(spaceCover(space({ 'space/s': a }, r(ago(25))), 'phone', NOW, LIMIT)).toMatchObject({ covered: false, waiting: false });
    expect(spaceCover(space({ 'space/s': a }, r(ago(1))), 'laptop', NOW, LIMIT).covered).toBe(false);
    expect(spaceCover(space({ 'space/s': a }, r(ago(-72))), 'phone', NOW, LIMIT).covered).toBe(false);
    expect(spaceCover(space({ 'space/s': a }, r(ago(1))), 'phone', NOW, LIMIT, (d) => d === 'laptop').covered).toBe(false);
  });

  it('needs every document of the space held here', () => {
    const { a, b } = docs();
    const local = { 'space/s': a, 'space/s/private': b };
    expect(spaceCover(space(local, { laptop: rec(ago(1), { 'space/s': a }) }), 'phone', NOW, LIMIT).covered).toBe(false);
    expect(spaceCover(space(local, { laptop: rec(ago(1), local) }), 'phone', NOW, LIMIT).covered).toBe(true);
  });

  it('takes the newest covering record, and survives a broken vector', () => {
    const { a } = docs();
    const bad: CoverRecord = { at: ago(1), kind: 'folder', encrypted: false, docs: { 'space/s': '!!!' } };
    const c = spaceCover(space({ 'space/s': a }, { x: rec(ago(5), { 'space/s': a }), y: rec(ago(3), { 'space/s': a }), z: bad }), 'phone', NOW, LIMIT);
    expect(c).toMatchObject({ covered: true, by: { device: 'y' } });
  });
});

describe('summarizeCover', () => {
  it('is undefined without any record from another device (a device that never syncs)', () => {
    const { a } = docs();
    expect(summarizeCover([space({ 'space/s': a }, {})], 'phone', NOW, LIMIT)).toBeUndefined();
    expect(summarizeCover([space({ 'space/s': a }, { phone: rec(ago(1), { 'space/s': a }) })], 'phone', NOW, LIMIT)).toBeUndefined();
  });

  it('lists the spaces not covered, skips empty ones, and names the newest device', () => {
    const { a } = docs();
    const changed = docs().a;
    changed.getMap('m').set('q', 1);
    const sum = summarizeCover(
      [
        space({ 'space/s': a }, { laptop: rec(ago(2), { 'space/s': a }) }),
        { ...space({ 'space/t': changed }, { laptop: rec(ago(30), { 'space/t': changed }) }), name: 'Home' },
        { ...space({ 'space/u': a }, {}), name: 'Empty', hasData: false },
      ],
      'phone',
      NOW,
      LIMIT,
    );
    expect(sum).toMatchObject({ covered: 1, waiting: 0, open: ['Home'], by: { device: 'laptop' }, last: { device: 'laptop' } });
  });
});

describe('records in a log document', () => {
  it('keeps one record per device, overwritten, and skips malformed ones', () => {
    const log = new Y.Doc();
    const { a } = docs();
    writeCover(log, 'laptop', rec(ago(5), { 'space/s': a }));
    writeCover(log, 'laptop', rec(ago(1), { 'space/s': a }));
    log.getMap(COVER_MAP).set('junk', 'text');
    log.getMap(COVER_MAP).set('bad-date', { at: 'nope', docs: {} });
    const out = readCover(log);
    expect([...out.keys()]).toEqual(['laptop']);
    expect(out.get('laptop')?.at).toBe(ago(1));
    expect(readCover(undefined).size).toBe(0);
  });

  it('reads a record that arrived by sync into a device that never asked for the map', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    writeCover(a, 'laptop', rec(ago(1), { 'space/s': new Y.Doc() }));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect([...readCover(b).keys()]).toEqual(['laptop']);
  });

  it('groups a backup by space and leaves out the account document', () => {
    const m = coverDocs(
      [
        { id: 'account/a1', state_vector_base64: 'A' },
        { id: 'space/s1', state_vector_base64: 'B' },
        { id: 'space/s1/private', state_vector_base64: 'C' },
      ],
      (id) => /^space\/([^/]+)/.exec(id)?.[1],
    );
    expect([...m]).toEqual([['s1', { 'space/s1': 'B', 'space/s1/private': 'C' }]]);
  });
});

describe('coverHealth', () => {
  const s = (patch: Partial<BackupState> = {}): BackupState => ({ folder: { state: 'unsupported' }, running: false, ...patch });
  const hoursAgo = (h: number) => new Date(NOW - h * H).toISOString();
  const cover = (c: Partial<CoverSummary>): CoverSummary => ({ open: [], covered: 0, waiting: 0, ...c });
  const by = { device: 'd-laptop', at: NOW - 2 * H };
  const name = () => 'Laptop';
  const health = (state: BackupState, c: CoverSummary) => {
    const own = backupHealth(state, NOW, true);
    return coverHealth(own, c, NOW, name, state.folder.state === 'unsupported');
  };

  it('says nothing when every space is covered, and names the device', () => {
    expect(health(s(), cover({ covered: 2, by }))).toMatchObject({ ok: true, kind: 'ok', covered: true, text: 'Backed up by Laptop, 2 hours ago.' });
  });

  it('also covers a stale own backup', () => {
    expect(health(s({ lastBackupAt: hoursAgo(40) }), cover({ covered: 1, by })).ok).toBe(true);
  });

  it('warns only about the spaces not covered, naming the fix and the device', () => {
    const h = health(s(), cover({ covered: 1, open: ['Work'], by }));
    expect(h).toMatchObject({ ok: false, kind: 'stale' });
    expect(h.text).toBe('Work has changes that are in no recent backup. Open Laptop so they reach it and it backs up, or download a backup.');
    expect(health(s(), cover({ covered: 1, open: ['Work', 'Home'], by })).text).toMatch(/^Work, Home have changes/);
  });

  it('waits for a recent backup that lacks the changes made here', () => {
    expect(health(s(), cover({ waiting: 1, by })).ok).toBe(true);
  });

  it('does not warn less when no record helps', () => {
    expect(health(s(), cover({ open: ['Work'] }))).toMatchObject({ ok: false, kind: 'never', text: backupHealth(s(), NOW, true).text });
    expect(health(s(), cover({ open: ['Work'], last: by }))).toMatchObject({ ok: false, kind: 'never' });
  });

  it('names the device that backs up when the backups are too old', () => {
    expect(health(s({ lastBackupAt: hoursAgo(30) }), cover({ open: ['Work'], last: by })).text).toBe('The last backup was 30 hours ago. Open Laptop so it backs up, or download a backup.');
    expect(health(s(), cover({ open: ['Work'], last: by })).text).toBe('No recent backup holds your latest changes. Open Laptop so it backs up (its last backup was 2 hours ago), or download a backup.');
  });

  it('keeps the own backup\'s result for a device that never syncs', () => {
    const own = backupHealth(s(), NOW, true);
    expect(own).toMatchObject({ ok: false, kind: 'never' });
  });
});
