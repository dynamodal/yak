import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { bulkEdit } from '../core/bulk';
import { setTagHidden } from '../core/hidden-tags';
import {
  clientProjectCount,
  createClient,
  createProject,
  deleteClient,
  deleteProject,
  deleteTag,
  ensureTag,
  liveClients,
  liveProjects,
  moveClientProjects,
  moveProjectEntries,
  pickerTagNames,
  projectEntryCount,
  renameTag,
  uniqueTagNames,
  updateClient,
  updateProject,
} from './catalog';
import { addManualEntry, liveEntries } from './entries';
import { at, makeSpaceDocs, syncDevices } from './testing';
import { trashItems } from '../core/trash';

const doc = () => makeSpaceDocs().get('personal')!;

describe('projects and clients', () => {
  it('creates a project with defaults and archives instead of deleting', () => {
    const d = doc();
    const cid = createClient(d, ' Acme ')!;
    const pid = createProject(d, { name: ' Site ', client_id: cid, rate: 80, billable: true })!;
    const p = liveProjects(d)[0]!;
    expect(p).toMatchObject({ id: pid, name: 'Site', client_id: cid, rate: 80, currency: 'USD', billable: true, active: true });
    expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(updateProject(d, pid, { active: false })).toBe(true);
    expect(liveProjects(d)).toHaveLength(1);
    expect(liveProjects(d)[0]!.active).toBe(false);
    expect(updateClient(d, cid, { archived: true })).toBe(true);
    expect(liveClients(d)[0]!.archived).toBe(true);
  });

  it('rejects empty names, bad colours and negative rates', () => {
    const d = doc();
    expect(createProject(d, { name: '  ' })).toBeNull();
    expect(createClient(d, '')).toBeNull();
    const pid = createProject(d, { name: 'P' })!;
    expect(updateProject(d, pid, { color: 'red' })).toBe(false);
    expect(updateProject(d, pid, { rate: -1 })).toBe(false);
    expect(updateProject(d, pid, { name: '' })).toBe(false);
    expect(updateProject(d, pid, { currency: 'eur', rate: null })).toBe(true);
    expect(liveProjects(d)[0]!.currency).toBe('EUR');
  });
});

describe('tags', () => {
  it('reuses an existing tag ignoring case', () => {
    const d = doc();
    expect(ensureTag(d, 'Deep work')).toBe('Deep work');
    expect(ensureTag(d, 'deep WORK')).toBe('Deep work');
    expect(uniqueTagNames(d)).toEqual(['Deep work']);
    expect(ensureTag(d, '  ')).toBeNull();
  });

  it('two devices creating the same tag name show it once', () => {
    const a = makeSpaceDocs();
    const b = makeSpaceDocs();
    ensureTag(a.get('personal')!, 'review');
    ensureTag(b.get('personal')!, 'Review');
    syncDevices(a, b);
    expect(uniqueTagNames(a.get('personal')!)).toEqual(uniqueTagNames(b.get('personal')!));
    expect(uniqueTagNames(a.get('personal')!)).toHaveLength(1);
  });

  it('renames in records and entries; deleting removes the name from entries', () => {
    const d = doc();
    ensureTag(d, 'old');
    ensureTag(d, 'keep');
    addManualEntry(d, 'x', { start: at(2026, 10, 14, 9), stop: at(2026, 10, 14, 10), tags: ['old', 'keep'] });
    renameTag(d, 'old', 'new');
    expect(uniqueTagNames(d)).toEqual(['keep', 'new']);
    expect(liveEntries(d)[0]!.tags).toEqual(['new', 'keep']);
    deleteTag(d, 'new');
    expect(uniqueTagNames(d)).toEqual(['keep']);
    expect(liveEntries(d)[0]!.tags).toEqual(['keep']);
  });
});

describe('bulk tag edits', () => {
  it('merges a tag into an existing one without a duplicate name', () => {
    const d = doc();
    ensureTag(d, 'a');
    ensureTag(d, 'B');
    addManualEntry(d, 'x', { start: at(2026, 10, 14, 9), stop: at(2026, 10, 14, 10), tags: ['a', 'b'] });
    addManualEntry(d, 'y', { start: at(2026, 10, 14, 11), stop: at(2026, 10, 14, 12), tags: ['a'] });
    expect(renameTag(d, 'a', 'b')).toBe(2);
    expect(uniqueTagNames(d)).toEqual(['B']);
    expect(liveEntries(d).map((e) => e.tags).sort()).toEqual([['B'], ['B']]);
  });

  it('one Undo reverses a rename across both documents', () => {
    const shared = new Y.Doc();
    const priv = new Y.Doc();
    ensureTag(shared, 'old');
    addManualEntry(priv, 'x', { start: at(2026, 10, 14, 9), stop: at(2026, 10, 14, 10), tags: ['old'] });
    const { result, undo } = bulkEdit([shared, priv], () => renameTag(shared, 'old', 'new', priv));
    expect(result).toBe(1);
    expect(liveEntries(priv)[0]!.tags).toEqual(['new']);
    undo();
    expect(liveEntries(priv)[0]!.tags).toEqual(['old']);
    expect(uniqueTagNames(shared)).toEqual(['old']);
  });

  it('hidden tags leave the picker list but stay in the space list and on entries', () => {
    const d = doc();
    ensureTag(d, 'keep');
    ensureTag(d, 'gone');
    addManualEntry(d, 'x', { start: at(2026, 10, 14, 9), stop: at(2026, 10, 14, 10), tags: ['gone'] });
    setTagHidden(d, 'Gone', true);
    expect(pickerTagNames(d)).toEqual(['keep']);
    expect(uniqueTagNames(d)).toEqual(['gone', 'keep']);
    expect(liveEntries(d)[0]!.tags).toEqual(['gone']);
    setTagHidden(d, 'gone', false);
    expect(pickerTagNames(d)).toEqual(['gone', 'keep']);
  });

  it('moves a project\'s entries and a client\'s projects', () => {
    const d = doc();
    const a = createProject(d, { name: 'A' }) as string;
    const b = createProject(d, { name: 'B' }) as string;
    addManualEntry(d, 'x', { start: at(2026, 10, 14, 9), stop: at(2026, 10, 14, 10), project_id: a });
    expect(projectEntryCount(d, a)).toBe(1);
    expect(moveProjectEntries(d, a, b)).toBe(1);
    expect(liveEntries(d)[0]!.project_id).toBe(b);
    const c = createClient(d, 'C') as string;
    updateProject(d, a, { client_id: c });
    expect(clientProjectCount(d, c)).toBe(1);
    expect(moveClientProjects(d, c, null)).toBe(1);
    expect(clientProjectCount(d, c)).toBe(0);
  });
});

describe('private rates through the catalog', () => {
  it('writes rate and currency to the private part and reads them back over the project', async () => {
    const Y = await import('yjs');
    const { readRate } = await import('../core/rates');
    const { collection } = await import('../core/schema');
    const shared = new Y.Doc();
    const priv = new Y.Doc();
    const id = createProject(shared, { name: 'Acme', rate: 50, currency: 'usd' }) as string;
    expect(updateProject(shared, id, { rate: 150, currency: 'eur', name: 'Acme Co' }, priv)).toBe(true);
    expect(readRate(priv, id)).toEqual({ rate: 150, currency: 'EUR' });
    // The shared project keeps the first-layout values; only the name changed there.
    expect(collection(shared, 'projects').get(id)?.get('rate')).toBe(50);
    expect(collection(shared, 'projects').get(id)?.get('name')).toBe('Acme Co');
    expect(liveProjects(shared, priv)[0]).toMatchObject({ rate: 150, currency: 'EUR' });
    expect(liveProjects(shared)[0]).toMatchObject({ rate: 50, currency: 'USD' });
    expect(updateProject(shared, 'missing', { rate: 1 }, priv)).toBe(false);
    expect(updateProject(shared, id, { rate: -1 }, priv)).toBe(false);
  });
});

describe('Recently deleted (B-107)', () => {
  it('deleting a project, client or tag stamps it; a tag merged by a rename is not listed', () => {
    const d = new Y.Doc();
    deleteProject(d, createProject(d, { name: 'P' })!);
    deleteClient(d, createClient(d, 'C')!);
    ensureTag(d, 'gone');
    deleteTag(d, 'gone');
    ensureTag(d, 'a');
    ensureTag(d, 'b');
    renameTag(d, 'a', 'b');
    expect(trashItems(d, 'projects').map((t) => t.title)).toEqual(['P']);
    expect(trashItems(d, 'clients').map((t) => t.title)).toEqual(['C']);
    expect(trashItems(d, 'tags').map((t) => t.title)).toEqual(['gone']);
    expect(trashItems(d, 'projects')[0]!.deletedAt).not.toBeNull();
  });
});
