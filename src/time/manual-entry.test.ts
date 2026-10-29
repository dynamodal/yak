import { describe, expect, it } from 'vitest';
import { manualDefaults, manualRange } from './manual-entry';
import { at } from './testing';

describe('manual entry helpers', () => {
  it('turns a date and two times into a range', () => {
    expect(manualRange('2026-10-14', '09:00', '10:30')).toEqual({ start: at(2026, 10, 14, 9), stop: at(2026, 10, 14, 10, 30) });
  });
  it('a stop at or before the start is on the next day', () => {
    expect(manualRange('2026-10-14', '23:00', '01:00')).toEqual({ start: at(2026, 10, 14, 23), stop: at(2026, 10, 15, 1) });
    expect(manualRange('2026-10-14', '09:00', '09:00')?.stop).toBe(at(2026, 10, 15, 9));
  });
  it('refuses missing or malformed values', () => {
    expect(manualRange('', '09:00', '10:00')).toBeNull();
    expect(manualRange('2026-10-14', '', '10:00')).toBeNull();
    expect(manualRange('2026-10-14', '9', '10:00')).toBeNull();
  });
  it('starts with the past hour', () => {
    expect(manualDefaults(at(2026, 10, 14, 15, 30, 40))).toEqual({ date: '2026-10-14', from: '14:30', to: '15:30' });
  });
});
