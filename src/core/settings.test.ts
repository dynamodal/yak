import { expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_SETTINGS,
  parseHoursFormat,
  readSettings,
  writeSetting,
  writeSettings,
} from './settings';

test('defaults when nothing is stored or the value is unknown', () => {
  expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  const doc = new Y.Doc();
  expect(readSettings(doc)).toEqual({ week_start: 'monday', hours_format: 'decimal' });
  doc.getMap('settings').set('week_start', 'friday');
  doc.getMap('settings').set('hours_format', 42);
  expect(readSettings(doc)).toEqual(DEFAULT_SETTINGS);
});

test('write and read back', () => {
  const doc = new Y.Doc();
  writeSetting(doc, 'week_start', 'sunday');
  writeSettings(doc, { hours_format: 'hm' });
  expect(readSettings(doc)).toEqual({ week_start: 'sunday', hours_format: 'hm' });
  expect(doc.getMap('settings').get('hours_format')).toBe('hm');
});

test('the legacy h:mm value reads as hm', () => {
  expect(parseHoursFormat('h:mm')).toBe('hm');
  expect(parseHoursFormat('hm')).toBe('hm');
  expect(parseHoursFormat('decimal1')).toBe('decimal1');
  expect(parseHoursFormat('decimal0')).toBe('decimal0');
  expect(parseHoursFormat('decimal')).toBe('decimal');
});
