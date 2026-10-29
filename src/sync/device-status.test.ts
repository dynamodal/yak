import { describe, expect, it } from 'vitest';
import { deviceStatus, peerStatus } from './device-status';

const base = { paired: true, online: true, signalingProblem: false };

describe('deviceStatus', () => {
  it('says not syncing outside an account', () => {
    expect(deviceStatus({ ...base, paired: false, peers: [] }).label).toBe('Not syncing');
  });

  it('puts being offline before everything else about a paired device', () => {
    expect(deviceStatus({ ...base, online: false, signalingProblem: true, peers: [{ state: 'connected' }] }).label).toBe('Offline');
  });

  it("reports a signaling problem even while waiting, but not while devices are linked on the network", () => {
    expect(deviceStatus({ ...base, signalingProblem: true, peers: [{ state: 'waiting-for-peer' }] }).label).toBe("Can't reach the connection server");
  });

  it('counts linked devices out of all other devices', () => {
    const s = deviceStatus({ ...base, peers: [{ state: 'connected' }, { state: 'waiting-for-peer' }, { state: 'connected' }] });
    expect(s.label).toBe('Syncing · 2 of 3');
    expect(s.dot).toBe('connected');
  });

  it('uses the words of the device rows when online and nobody is linked', () => {
    expect(deviceStatus({ ...base, peers: [] })).toMatchObject({ label: 'No other devices', dot: 'waiting-for-peer' });
    expect(deviceStatus({ ...base, peers: [{ state: 'waiting-for-peer' }] }).label).toBe('Waiting');
    expect(deviceStatus({ ...base, peers: [{ state: 'waiting-for-peer' }, { state: 'connecting' }] }).label).toBe('Connecting…');
  });

  it('names the relay when every link goes through it', () => {
    const relay = deviceStatus({ ...base, peers: [{ state: 'connected', via: 'relay' }, { state: 'waiting-for-peer' }] });
    expect(relay.label).toBe('Syncing through the relay · 1 of 2');
    expect(relay.hint).toContain('through the relay');
    expect(deviceStatus({ ...base, peers: [{ state: 'connected', via: 'relay' }, { state: 'connected', via: 'direct' }] }).label).toBe('Syncing · 2 of 2');
  });

  it('says when another tab does the syncing', () => {
    const s = deviceStatus({ ...base, otherTab: true, peers: [{ state: 'connected' }] });
    expect(s.label).toBe('Syncing in another tab · 1 of 1');
    expect(s.hint).toContain('Another tab of this browser');
    expect(deviceStatus({ ...base, otherTab: true, peers: [] }).label).toBe('No other devices');
  });
});

describe('peerStatus', () => {
  it('names the three states of another device', () => {
    expect(peerStatus('connected').label).toBe('Syncing directly');
    expect(peerStatus('connected', 'relay').label).toBe('Syncing through the relay');
    expect(peerStatus('waiting-for-peer').label).toBe('Waiting');
    expect(peerStatus('connecting').label).toBe('Connecting…');
    expect(peerStatus('reconnecting').label).toBe('Connecting…');
  });
});
