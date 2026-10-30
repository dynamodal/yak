import { describe, expect, it } from 'vitest';
import { shortDeviceId } from './device-id';

describe('shortDeviceId', () => {
  it('keeps the first 8 characters of the id', () => {
    expect(shortDeviceId('3f2a9c1e-5b7d-4e08-9a41-0c6d2b8e7f10')).toBe('3f2a9c1e');
  });
  it('tells apart two devices that share a name', () => {
    expect(shortDeviceId('aaaaaaaa-0000')).not.toBe(shortDeviceId('bbbbbbbb-0000'));
  });
  it('leaves a short id whole', () => {
    expect(shortDeviceId('abc')).toBe('abc');
  });
});
