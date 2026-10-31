import { describe, expect, it } from 'vitest';
import { attemptHint, attemptLine, type AttemptRecord, connectionReport, countCandidates, emptyCounts, natKind, parseCandidate, samePublic, sdpCandidates } from './link-diagnostics';

const SDP = [
  'v=0',
  'a=candidate:1 1 udp 2113937151 3f1c2a9e-1111-4222-8333-444455556666.local 54321 typ host generation 0',
  'a=candidate:2 1 udp 2113937151 192.168.1.20 54324 typ host generation 0',
  'a=candidate:3 1 udp 2113937151 2001:db8::5 54325 typ host generation 0',
  'a=candidate:4 1 udp 1677729535 203.0.113.9 40001 typ srflx raddr 192.168.1.20 rport 54324 generation 0',
  'a=candidate:5 1 udp 1677729535 203.0.113.9 40002 typ srflx raddr 192.168.1.20 rport 54324 generation 0',
  'a=ice-ufrag:abcd',
].join('\r\n');

const record = (over: Partial<AttemptRecord> = {}): AttemptRecord => ({
  at: Date.UTC(2026, 9, 30, 12, 5),
  role: 'offer',
  trigger: 'retry',
  local: { ...emptyCounts(), host: 1 },
  remote: { ...emptyCounts(), host: 1 },
  natLocal: 'unknown',
  natRemote: 'unknown',
  samePublic: 'unknown',
  stage: 'checks-failed',
  ms: 4200,
  ...over,
});

describe('candidates', () => {
  it('parses lines with or without a=', () => {
    expect(parseCandidate('candidate:9 1 UDP 1 10.0.0.2 5000 typ host')).toEqual({ component: '1', protocol: 'udp', address: '10.0.0.2', port: '5000', type: 'host' });
    expect(parseCandidate('a=ice-ufrag:x')).toBeUndefined();
  });

  it('counts kinds: real host, mDNS name, STUN, IPv6', () => {
    expect(countCandidates(sdpCandidates(SDP))).toEqual({ host: 2, mdns: 1, srflx: 2, prflx: 0, relay: 0, v6: 1 });
  });

  it('tells a NAT that maps per destination from one that does not', () => {
    expect(natKind(sdpCandidates(SDP))).toBe('varies');
    expect(natKind(sdpCandidates(SDP).slice(0, 4))).toBe('stable');
    expect(natKind([])).toBe('unknown');
  });

  it('compares public addresses without needing both to be known', () => {
    const mine = sdpCandidates(SDP);
    const other = sdpCandidates('a=candidate:1 1 udp 1 198.51.100.7 40001 typ srflx raddr 0.0.0.0 rport 0');
    expect(samePublic(mine, mine)).toBe('yes');
    expect(samePublic(mine, other)).toBe('no');
    expect(samePublic(mine, sdpCandidates(SDP).slice(0, 2))).toBe('unknown');
  });
});

describe('attempt line and hint', () => {
  it('logs kinds and counts, never an address or a port', () => {
    const line = attemptLine(record({ local: countCandidates(sdpCandidates(SDP)), natLocal: 'varies', pairs: 4 }));
    expect(line).toBe('offer retry: local host 2 mdns 1 srflx 2 v6 1, remote host 1; same public unknown; nat varies (varies/unknown); connectivity checks failed (4 pairs); 4.2 s');
    expect(line).not.toMatch(/\d+\.\d+\.\d+\.\d+|::|\b40001\b/);
  });

  it('names the chosen path when the channel opened', () => {
    expect(attemptLine(record({ stage: 'open', path: 'host/host udp', rttMs: 10 }))).toContain('open host/host udp rtt 10ms');
    expect(attemptHint(record({ stage: 'open' }))).toBeUndefined();
  });

  it('gives a plain reason for each failure pattern', () => {
    const mdns = { ...emptyCounts(), mdns: 1 };
    expect(attemptHint(record({ stage: 'no-answer' }))).toMatch(/did not answer/);
    expect(attemptHint(record({ remote: emptyCounts() }))).toMatch(/other device offered no addresses/);
    expect(attemptHint(record({ local: mdns, remote: mdns }))).toMatch(/camera/);
    expect(attemptHint(record({ samePublic: 'yes' }))).toMatch(/same network/);
    expect(attemptHint(record({ samePublic: 'no', natRemote: 'varies' }))).toMatch(/router on one side/);
    expect(attemptHint(record({ samePublic: 'no' }))).toMatch(/different networks/);
    expect(attemptHint(record())).toBe('No direct path was found.');
  });
});

describe('connection report', () => {
  it('numbers the other devices and lists their attempts with UTC times', () => {
    const text = connectionReport({ version: '1.2.3', browser: 'Chrome 140', now: Date.UTC(2026, 9, 30, 13, 0), peers: [{ state: 'connected', via: 'relay', attempts: [record()] }, { state: 'waiting-for-peer' }] });
    expect(text.split('\n')).toEqual([
      'Connection report (no names, ids, addresses or ports)',
      'App 1.2.3 · Chrome 140',
      'Made 2026-10-30T13:00Z',
      '',
      'Other device 1: connected (relay)',
      '  12:05Z offer retry: local host 1, remote host 1; same public unknown; connectivity checks failed; 4.2 s',
      '',
      'Other device 2: waiting-for-peer',
      '  no attempts recorded since the page opened',
    ]);
  });
});
