import { describe, expect, it } from 'vitest';
import { decodeSignal, encodeSignal, trimSdp } from './signal-codec';

const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 3f1c2a9e-1111-4222-8333-444455556666.local 54321 typ host generation 0',
  'a=candidate:2 1 udp 2113939711 fe80::1 54322 typ host generation 0',
  'a=candidate:3 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active generation 0',
  'a=candidate:4 1 udp 1677729535 203.0.113.9 54323 typ srflx raddr 0.0.0.0 rport 0 generation 0',
  'a=candidate:5 1 udp 2113937151 192.168.1.20 54324 typ host generation 0',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:0123456789abcdef012345',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  '',
].join('\r\n');

describe('trimSdp', () => {
  it('keeps UDP host candidates, including mDNS names, and UDP server-reflexive ones', () => {
    const lines = trimSdp(SDP).split('\r\n').filter((l) => l.startsWith('a=candidate:'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('.local');
    expect(lines[1]).toContain('typ srflx');
    expect(lines[2]).toContain('192.168.1.20 54324');
  });

  it('drops TCP and relay candidates', () => {
    const sdp = [
      'a=candidate:1 1 tcp 1518280447 203.0.113.9 9 typ srflx raddr 0.0.0.0 rport 0 tcptype active generation 0',
      'a=candidate:2 1 udp 41885439 198.51.100.4 3478 typ relay raddr 203.0.113.9 rport 54323 generation 0',
    ].join('\r\n');
    expect(trimSdp(sdp)).toBe('');
  });

  it('drops link-local and carrier-grade-NAT (VPN, Tailscale) addresses but keeps private LAN ranges', () => {
    const sdp = [
      'a=candidate:1 1 udp 2113937151 192.168.1.20 5000 typ host generation 0',
      'a=candidate:2 1 udp 2113937151 10.0.0.7 5001 typ host generation 0',
      'a=candidate:3 1 udp 2113937151 172.20.4.9 5002 typ host generation 0',
      'a=candidate:4 1 udp 2113937151 100.101.102.103 5003 typ host generation 0',
      'a=candidate:5 1 udp 2113937151 100.63.1.1 5004 typ host generation 0',
      'a=candidate:6 1 udp 2113937151 169.254.12.3 5005 typ host generation 0',
    ].join('\r\n');
    const kept = trimSdp(sdp).split('\r\n').map((l) => l.split(' ')[4]);
    expect(kept).toEqual(['192.168.1.20', '10.0.0.7', '172.20.4.9', '100.63.1.1']);
  });

  it('leaves every non-candidate line untouched', () => {
    const out = trimSdp(SDP).split('\r\n');
    expect(out).toContain('a=ice-ufrag:abcd');
    expect(out).toContain('a=sctp-port:5000');
  });
});

describe('signal codec', () => {
  it('round-trips an offer', async () => {
    const code = await encodeSignal({ kind: 'offer', sdp: SDP });
    expect(code.startsWith('yk1.')).toBe(true);
    const back = await decodeSignal(code);
    expect(back.kind).toBe('offer');
    expect(back.sdp).toBe(trimSdp(SDP));
  });

  it('round-trips an answer and tolerates whitespace from copy and paste', async () => {
    const code = await encodeSignal({ kind: 'answer', sdp: SDP });
    const wrapped = `  ${code.slice(0, 20)}\n${code.slice(20)}  `;
    expect((await decodeSignal(wrapped)).kind).toBe('answer');
  });

  it('produces a code far smaller than one QR code for a typical offer', async () => {
    const code = await encodeSignal({ kind: 'offer', sdp: SDP });
    expect(code.length).toBeLessThan(900);
    expect(code).toMatch(/^yk1\.[A-Za-z0-9_-]+$/);
  });

  it('rejects text that is not a pairing code', async () => {
    await expect(decodeSignal('hello')).rejects.toThrow(/wrong prefix/);
  });

  it('rejects a damaged code', async () => {
    const code = await encodeSignal({ kind: 'offer', sdp: SDP });
    await expect(decodeSignal(code.slice(0, 30))).rejects.toThrow(/damaged or incomplete/);
  });
});

it('rejects a sync code from the earlier version with a clear message', async () => {
  await expect(decodeSignal('pd1.abc')).rejects.toThrow(/earlier test version/);
});
