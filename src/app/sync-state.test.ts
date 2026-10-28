import { describe, expect, it } from 'vitest';
import { LINK_KIND_LABEL, linkKind, SYNC_SHAPE_TEXT, syncShape } from './sync-state';

describe('syncShape', () => {
  it('is off when sync was never set up', () => {
    expect(syncShape({ paired: false, peers: [] })).toBe('off');
  });
  it('is off when paired but no other device is known yet', () => {
    expect(syncShape({ paired: true, peers: [] })).toBe('off');
  });
  it('is off when unpaired, whatever stale peers say', () => {
    expect(syncShape({ paired: false, peers: [{ state: 'connected', via: 'direct' }] })).toBe('off');
  });
  it('is direct when any device is linked directly', () => {
    expect(syncShape({ paired: true, peers: [{ state: 'connected', via: 'direct' }] })).toBe('direct');
    expect(syncShape({ paired: true, peers: [{ state: 'connected', via: 'relay' }, { state: 'connected', via: 'direct' }] })).toBe('direct');
  });
  it('counts a linked device with no known path as direct', () => {
    expect(syncShape({ paired: true, peers: [{ state: 'connected' }] })).toBe('direct');
  });
  it('is relay when every linked device goes through the relay', () => {
    expect(syncShape({ paired: true, peers: [{ state: 'connected', via: 'relay' }, { state: 'waiting-for-peer' }] })).toBe('relay');
  });
  it('is offline when paired and nothing is linked', () => {
    expect(syncShape({ paired: true, peers: [{ state: 'waiting-for-peer' }] })).toBe('offline');
    expect(syncShape({ paired: true, peers: [{ state: 'connecting' }, { state: 'reconnecting' }, { state: 'stopped' }] })).toBe('offline');
  });
  it('has words for every shape, starting with a label that differs per shape', () => {
    const labels = Object.values(SYNC_SHAPE_TEXT).map((t) => t.label);
    expect(new Set(labels).size).toBe(4);
  });
});

describe('linkKind', () => {
  it('names the path of a linked device', () => {
    expect(linkKind({ state: 'connected', via: 'direct' })).toBe('direct');
    expect(linkKind({ state: 'connected', via: 'relay' })).toBe('relay');
    expect(linkKind({ state: 'connected' })).toBe('direct');
  });
  it('says connecting while a link is made, not connected otherwise', () => {
    expect(linkKind({ state: 'connecting' })).toBe('connecting');
    expect(linkKind({ state: 'reconnecting' })).toBe('connecting');
    expect(linkKind({ state: 'waiting-for-peer' })).toBe('none');
    expect(linkKind({ state: 'stopped' })).toBe('none');
    expect(LINK_KIND_LABEL.none).toBe('Not connected');
  });
});
