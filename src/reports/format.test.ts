import { describe, expect, test } from 'vitest';
import { clockDuration, decimalHours, formatCompact, formatAmounts, formatDuration, formatMoney, formatPercent, parseHoursFormat, rangeLabel } from './format';
import { at, useTimeZone } from './testing';

const H = 3_600_000;

describe('formatDuration', () => {
  test('decimal hours with two places', () => {
    expect(formatDuration(1.25 * H, 'decimal')).toBe('1.25 h');
    expect(formatDuration(0, 'decimal')).toBe('0.00 h');
    expect(formatDuration(100.5 * H, 'decimal')).toBe('100.50 h');
  });

  test('decimal hours with one place or none (#99)', () => {
    expect(formatDuration(1.25 * H, 'decimal1')).toBe('1.3 h');
    expect(formatDuration(1.24 * H, 'decimal1')).toBe('1.2 h');
    expect(formatDuration(1.6 * H, 'decimal0')).toBe('2 h');
    expect(formatDuration(0, 'decimal0')).toBe('0 h');
    expect(formatCompact(1.6 * H, 'decimal1')).toBe('1.6');
    expect(parseHoursFormat('decimal1')).toBe('decimal1');
    expect(parseHoursFormat('decimal0')).toBe('decimal0');
    expect(parseHoursFormat('nonsense')).toBe('decimal');
  });

  test('h:mm rounds to the nearest minute', () => {
    expect(formatDuration(1.25 * H, 'hm')).toBe('1:15');
    expect(formatDuration(59 * 60_000 + 40_000, 'hm')).toBe('1:00');
    expect(formatDuration(5 * 60_000, 'hm')).toBe('0:05');
    expect(formatDuration(130 * H, 'hm')).toBe('130:00');
  });

  test('bad input is zero', () => {
    expect(formatDuration(Number.NaN, 'decimal')).toBe('0.00 h');
    expect(formatDuration(-5, 'hm')).toBe('0:00');
  });
});

test('the hours_format setting: decimal by default, h:mm as the alternative', () => {
  expect(parseHoursFormat(undefined)).toBe('decimal');
  expect(parseHoursFormat('decimal')).toBe('decimal');
  expect(parseHoursFormat('h:mm')).toBe('hm');
  expect(parseHoursFormat(42)).toBe('decimal');
});

test('machine-friendly durations', () => {
  expect(decimalHours(90 * 60_000)).toBe('1.5000');
  expect(clockDuration(3_723_000)).toBe('1:02:03');
});

test('percentages', () => {
  expect(formatPercent(1, 4)).toBe('25%');
  expect(formatPercent(1, 1000)).toBe('<1%');
  expect(formatPercent(0, 10)).toBe('0%');
  expect(formatPercent(5, 0)).toBe('0%');
});

test('money per currency, with a fallback for unknown codes', () => {
  expect(formatMoney(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
  expect(formatMoney(5, 'not a code', 'en-US')).toBe('5.00 not a code');
  expect(formatAmounts({}, 'en-US')).toBe('—');
  expect(formatAmounts({ USD: 10, EUR: 5 }, 'en-US')).toBe('€5.00, $10.00');
});

describe('range labels', () => {
  useTimeZone('Europe/Berlin');
  test('single day and span', () => {
    expect(rangeLabel({ from: at(2025, 3, 3), to: at(2025, 3, 4) })).toBe('2025-03-03');
    expect(rangeLabel({ from: at(2025, 3, 3), to: at(2025, 3, 10) })).toBe('2025-03-03 to 2025-03-09');
  });
});
