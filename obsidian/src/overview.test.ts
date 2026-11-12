import { describe, expect, it } from 'vitest';
import { deviceRows, spaceRows } from './overview';

const spaces = [
  { id: 'a', name: 'Personal', archived: false },
  { id: 'b', name: 'Work', archived: false },
  { id: 'c', name: 'Old', archived: true },
];

describe('spaceRows', () => {
  it('shows the status of kept spaces only', () => {
    const rows = spaceRows({ spaces, keeps: (id) => id !== 'b', loaded: new Set(['a']), held: new Set() });
    expect(rows.map((r) => [r.name, r.kept, r.status])).toEqual([
      ['Personal', true, 'Kept here'],
      ['Work', false, ''],
      ['Old', true, 'Waiting for its notes'],
    ]);
  });
  it('hides an archived space this vault does not keep and flags a missing folder', () => {
    const rows = spaceRows({ spaces, keeps: (id) => id === 'a', loaded: new Set(['a']), held: new Set(['a']) });
    expect(rows.map((r) => r.name)).toEqual(['Personal', 'Work']);
    expect(rows[0]!.status).toMatch(/Folder missing/);
  });
});

describe('deviceRows', () => {
  const devices = new Map([
    ['me', { name: 'This', removed: false, left: false }],
    ['d1', { name: 'Laptop', removed: false, left: false }],
    ['d2', { removed: false, left: false }],
    ['d3', { name: 'Gone', removed: true, left: false }],
    ['d4', { name: 'Left', removed: false, left: true }],
  ]);
  it('lists other devices, connected first, with the spaces they keep', () => {
    const rows = deviceRows({
      me: 'me',
      devices,
      spaces,
      keeps: (d, s) => (d === 'd1' && (s === 'a' || s === 'c')) || (d === 'd2' && s === 'b'),
      peers: [{ id: 'd1', state: 'connected' }, { id: 'd2', state: 'offline', lastSeenAt: 1_000_000 - 5 * 60_000 }],
      now: 1_000_000,
    });
    expect(rows).toEqual([
      { id: 'd1', name: 'Laptop', presence: 'Connected', kept: 'Personal' },
      { id: 'd2', name: 'Device d2', presence: 'Last seen 5 min ago', kept: 'Work' },
    ]);
  });
  it('says so when a device was never seen or keeps nothing', () => {
    const rows = deviceRows({ me: 'x', devices: new Map([['d1', { name: 'A', removed: false, left: false }]]), spaces, keeps: () => false, peers: [], now: 0 });
    expect(rows[0]).toMatchObject({ presence: 'Not connected', kept: 'No spaces kept' });
  });
});
