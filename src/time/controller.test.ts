import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/bus';
import { TimeController } from './controller';
import { collection } from '../core/schema';
import { findRunning, liveEntries, restoreEntry } from './entries';
import { at, makeSpaceDocs, syncDevices } from './testing';

const T0 = at(2026, 10, 14, 9);

function setup() {
  const docs = makeSpaceDocs();
  const bus = new EventBus();
  const events: string[] = [];
  bus.on('timer:started', (e) => events.push(`started ${e.spaceId} ${e.entryId}`));
  bus.on('timer:stopped', (e) => events.push(`stopped ${e.spaceId} ${e.entryId}`));
  return { docs, bus, events, ctl: new TimeController(docs, bus, 'dev') };
}

describe('TimeController', () => {
  it('emits started, and stopped for the timer it replaces', () => {
    const { ctl, events } = setup();
    const a = ctl.start('personal', { description: 'a' }, T0);
    const b = ctl.start('work', { description: 'b' }, T0 + 60_000);
    expect(events).toEqual([`started personal ${a}`, `stopped personal ${a}`, `started work ${b}`]);
    ctl.stop({ spaceId: 'work', id: b }, T0 + 120_000);
    expect(events.at(-1)).toBe(`stopped work ${b}`);
  });

  it('discards a running timer as a soft delete that can be restored, and announces the stop', () => {
    const { ctl, docs, events } = setup();
    const id = ctl.start('personal', { description: 'oops' }, T0);
    expect(ctl.discard({ spaceId: 'personal', id }, T0 + 90_000)).toBe(true);
    expect(findRunning(docs)).toHaveLength(0);
    expect(liveEntries(docs.get('personal')!)).toHaveLength(0);
    expect(events.at(-1)).toBe(`stopped personal ${id}`);
    const doc = docs.get('personal')!;
    expect(collection(doc, 'time_entries').get(id)?.get('deleted')).toBe(true);
    expect(restoreEntry(doc, id, T0 + 100_000)).toEqual({ ok: true });
    const back = liveEntries(doc)[0]!;
    expect(back).toMatchObject({ description: 'oops', duration: 90 });
    expect(back.stop).not.toBeNull();
    expect(ctl.discard({ spaceId: 'nowhere', id }, T0)).toBe(false);
  });

  it('starts from a bus request, with the task and project', () => {
    const { ctl, bus, docs } = setup();
    bus.on('timer:start-request', (r) => ctl.handleStartRequest(r));
    bus.emit('timer:start-request', { spaceId: 'work', description: 'Do it', taskId: 'note-1', tags: ['x'] });
    const e = liveEntries(docs.get('work')!)[0]!;
    expect(e).toMatchObject({ description: 'Do it', task_id: 'note-1', tags: ['x'], stop: null });
    bus.emit('timer:start-request', { spaceId: 'nowhere', description: 'x' });
    expect(findRunning(docs)).toHaveLength(1);
  });

  it('announces timers stopped by the rule', () => {
    const { docs, ctl, events } = setup();
    const other = makeSpaceDocs();
    const oldId = new TimeController(other, new EventBus(), 'o').start('personal', {}, T0);
    ctl.start('personal', {}, T0 + 60_000);
    syncDevices(docs, other);
    events.length = 0;
    expect(ctl.enforce().map((r) => r.id)).toEqual([oldId]);
    expect(events).toEqual([`stopped personal ${oldId}`]);
  });

  it('discards idle time, optionally continuing', () => {
    const { docs, ctl } = setup();
    const id = ctl.start('personal', { description: 'work', tags: ['t'] }, T0);
    const ref = findRunning(docs)[0]!;
    ctl.discardIdle(ref, T0 + 30 * 60_000, true, T0 + 90 * 60_000);
    const es = liveEntries(docs.get('personal')!).sort((a, b) => a.start.localeCompare(b.start));
    expect(es).toHaveLength(2);
    expect(es[0]).toMatchObject({ id, duration: 1800 });
    expect(es[1]).toMatchObject({ description: 'work', tags: ['t'], stop: null });
    expect(es[1]!.start).toBe(new Date(T0 + 90 * 60_000).toISOString());
  });
});
