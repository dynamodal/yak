import { describe, expect, it } from 'vitest';
import { defaultDeviceName, syncStatusLine } from './device-name';

describe('default device name', () => {
  it('tells a phone from a laptop with the same vault name', () => {
    const id = 'a1b2c3d4-0000-4000-8000-000000000000';
    expect(defaultDeviceName('Notes', false, id)).toBe('Obsidian (Notes, desktop, a1b2)');
    expect(defaultDeviceName('Notes', true, id)).toBe('Obsidian (Notes, mobile, a1b2)');
  });

  it('tells two devices of one kind apart by id', () => {
    expect(defaultDeviceName('Notes', true, 'aaaa1111')).not.toBe(defaultDeviceName('Notes', true, 'bbbb2222'));
  });
});

describe('sync status line', () => {
  it('says when the vault has not joined', () => {
    expect(syncStatusLine({ joined: false, joining: false, connected: 0, devices: 0 })).toMatch(/^Not joined/);
    expect(syncStatusLine({ joined: false, joining: true, connected: 0, devices: 0 })).toMatch(/^Joining/);
  });

  it('counts connected devices out of the others in the account', () => {
    expect(syncStatusLine({ joined: true, joining: false, connected: 1, devices: 3 })).toBe('Syncing 1 of 2 other devices.');
  });

  it('says a removed vault was removed and how to join again (#140)', () => {
    for (const joined of [false, true]) expect(syncStatusLine({ removed: true, joined, joining: false, connected: 0, devices: 2 })).toMatch(/^Removed from your account.*join again/);
    expect(syncStatusLine({ removed: true, joined: false, joining: true, connected: 0, devices: 2 })).toMatch(/^Joining/);
  });

  it('copes with an account document that has not arrived', () => {
    expect(syncStatusLine({ joined: true, joining: false, connected: 0, devices: 0 })).toMatch(/^Joined/);
  });
});
