import { describe, expect, it } from 'vitest';
import { generateSecret, normalizeSecret } from '../sync/pairing-secret';
import jsQR from 'jsqr';
import { decodePixels as decode } from './decode';

const decodePixels = (f: Parameters<typeof decode>[1]) => decode(jsQR, f);
import { encodePairingPayload, groupSecret, joinLink, parseJoinInput, parsePairingPayload } from './payload';
import { makeQr } from './render';

const secret = generateSecret();

describe('pairing payload', () => {
  it('round trips the secret without dashes and omits the default server', () => {
    const text = encodePairingPayload(secret);
    expect(text).toBe(`yak:pair?v=1&s=${normalizeSecret(secret)}`);
    expect(parsePairingPayload(text)).toEqual({ secret: normalizeSecret(secret) });
    expect(encodePairingPayload(secret, 'https://ntfy.sh/')).toBe(text);
  });

  it('carries a non-default signaling server, URL-encoded', () => {
    const text = encodePairingPayload(secret, 'https://ntfy.example.com/x?y=1');
    expect(text).toContain('sig=https%3A%2F%2Fntfy.example.com');
    expect(parsePairingPayload(text).signalingUrl).toBe('https://ntfy.example.com/x?y=1');
  });

  it('rejects other QR codes and bad payloads', () => {
    expect(() => parsePairingPayload('https://example.com')).toThrow(/not a Yak/);
    expect(() => parsePairingPayload('WIFI:S:x;;')).toThrow(/not a Yak/);
    expect(() => parsePairingPayload('punchdeck:pair?v=1&s=AAAA')).toThrow(/earlier test version/);
    expect(() => parsePairingPayload(`yak:pair?v=2&s=${normalizeSecret(secret)}`)).toThrow(/different version/);
    expect(() => parsePairingPayload('yak:pair?v=1')).toThrow(/28 characters/);
    expect(() => parsePairingPayload(`yak:pair?v=1&s=${normalizeSecret(secret).slice(0, 27)}${normalizeSecret(secret).endsWith('A') ? 'B' : 'A'}`)).toThrow();
    expect(() => parsePairingPayload(`yak:pair?v=1&s=${normalizeSecret(secret)}&sig=javascript:alert(1)`)).toThrow(/http/);
    expect(() => parsePairingPayload(`yak:pair?v=1&s=${normalizeSecret(secret)}&sig=nonsense`)).toThrow(/valid URL/);
  });

  it('carries a relay URL', () => {
    const text = encodePairingPayload(secret, 'ws://localhost:8787/signal');
    expect(parsePairingPayload(text).signalingUrl).toBe('ws://localhost:8787/signal');
  });
});

function rasterise(text: string, scale = 6, quiet = 4) {
  const m = makeQr(text);
  const side = (m.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const r = Math.floor(y / scale) - quiet;
      const c = Math.floor(x / scale) - quiet;
      if (r >= 0 && c >= 0 && r < m.size && c < m.size && m.dark[r * m.size + c]) {
        const i = (y * side + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, width: side, height: side };
}

describe('QR round trip', () => {
  it('decodes a generated code back to the payload', () => {
    for (const sig of [undefined, 'https://ntfy.example.com/some/path']) {
      const text = encodePairingPayload(secret, sig);
      const decoded = decodePixels(rasterise(text));
      expect(decoded).toBe(text);
      expect(parsePairingPayload(decoded ?? '').secret).toBe(normalizeSecret(secret));
    }
  });

  it('finds nothing in a blank image', () => {
    expect(decodePixels({ data: new Uint8ClampedArray(100 * 100 * 4).fill(255), width: 100, height: 100 })).toBeNull();
  });
});

describe('join link and pasted input (option A+)', () => {
  const base = 'https://yak.example.com/?x=1#/settings/devices/add';
  it('makes a link that parses back to the same code', () => {
    const link = joinLink(base, secret);
    expect(link).toBe(`https://yak.example.com/?x=1#/join/${normalizeSecret(secret)}`);
    expect(parseJoinInput(link)).toEqual({ secret: normalizeSecret(secret) });
    expect(parseJoinInput(`  ${link}\n`)).toEqual({ secret: normalizeSecret(secret) });
  });
  it('carries a non-default server in the link', () => {
    const link = joinLink(base, secret, 'wss://relay.example.com/signal');
    expect(parseJoinInput(link)).toEqual({ secret: normalizeSecret(secret), signalingUrl: 'wss://relay.example.com/signal' });
  });
  it('accepts the QR text, and leaves a plain code to the caller', () => {
    expect(parseJoinInput(encodePairingPayload(secret))).toEqual({ secret: normalizeSecret(secret) });
    expect(parseJoinInput(secret)).toBeUndefined();
    expect(parseJoinInput('abcd efgh')).toBeUndefined();
  });
  it('rejects a link with a bad or missing code', () => {
    expect(() => parseJoinInput('https://yak.example.com/#/join/')).toThrow(/no Yak one-time code/);
    expect(() => parseJoinInput('https://yak.example.com/#/join/ABCD')).toThrow(/characters/);
  });
  it('groups a code in fours', () => {
    expect(groupSecret(normalizeSecret(secret))).toBe(secret);
    expect(groupSecret('abcdefg')).toBe('abcd-efg');
  });
});
