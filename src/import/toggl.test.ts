import { describe, expect, it } from 'vitest';
import { mapHeaders, parseBillable, parseDate, parseDecimalHours, parseDuration, parseRow, parseStamp, parseTime, splitTags } from './toggl';

const HEADER = ['User', 'Email', 'Client', 'Project', 'Task', 'Description', 'Billable', 'Start date', 'Start time', 'End date', 'End time', 'Duration', 'Tags', 'Amount (USD)'];

function row(over: Record<string, string>): string[] {
  const base: Record<string, string> = {
    User: 'Sample Person',
    Email: 'person@example.com',
    Client: 'Example Client',
    Project: 'Website',
    Task: '',
    Description: 'Work',
    Billable: 'Yes',
    'Start date': '2025-03-10',
    'Start time': '09:00:00',
    'End date': '2025-03-10',
    'End time': '10:30:00',
    Duration: '1:30:00',
    Tags: '',
    'Amount (USD)': '10.00',
  };
  return HEADER.map((h) => over[h] ?? base[h] ?? '');
}

const map = mapHeaders(HEADER).map;
const parse = (over: Record<string, string>, zone = 'UTC') => parseRow(row(over), map, zone, 2);
const ok = (over: Record<string, string>, zone = 'UTC') => {
  const r = parse(over, zone);
  if (!r.ok) throw new Error(r.error);
  return r.row;
};
const iso = (ms: number): string => new Date(ms).toISOString();

describe('parseRow with decimal Duration', () => {
  it('accepts decimal hours in the Duration column', () => {
    const r = ok({ 'Start time': '11:17:00', 'End time': '11:25:00', Duration: '0.13' });
    expect(iso(r.stop - r.start)).toBe(iso(8 * 60_000));
    expect(r.durationMismatch).toBe(false);
  });
});

describe('mapHeaders', () => {
  it('finds the standard Detailed export columns', () => {
    const h = mapHeaders(HEADER);
    expect(h.problems).toEqual([]);
    expect(h.map).toMatchObject({ user: 0, email: 1, client: 2, project: 3, task: 4, description: 5, billable: 6, startDate: 7, startTime: 8, endDate: 9, endTime: 10, duration: 11, tags: 12 });
    expect(h.ignored).toEqual(['Amount (USD)']);
  });

  it('ignores case, spacing and a byte-order mark', () => {
    const h = mapHeaders(['﻿DESCRIPTION', ' start  DATE ', 'START time', 'duration']);
    expect(h.map).toEqual({ description: 0, startDate: 1, startTime: 2, duration: 3 });
    expect(h.problems).toEqual([]);
  });

  it('accepts combined Start/End columns, Member and decimal duration', () => {
    const h = mapHeaders(['Member', 'Start', 'End', 'Duration (decimal)', 'Project name']);
    expect(h.map).toEqual({ user: 0, start: 1, end: 2, durationDecimal: 3, project: 4 });
    expect(h.problems).toEqual([]);
  });

  it('tolerates extra columns and missing optional ones', () => {
    const h = mapHeaders(['Foo', 'Start date', 'Start time', 'Duration']);
    expect(h.problems).toEqual([]);
    expect(h.map.project).toBeUndefined();
    expect(h.ignored).toEqual(['Foo']);
  });

  it('reports what is missing', () => {
    expect(mapHeaders(['Description', 'Duration']).problems[0]).toMatch(/Start date/);
    expect(mapHeaders(['Start date', 'Description', 'Duration']).problems[0]).toMatch(/Start time/);
    expect(mapHeaders(['Start date', 'Start time', 'Description']).problems[0]).toMatch(/End date|Duration/);
  });
});

describe('cell parsers', () => {
  it('parses dates', () => {
    expect(parseDate('2025-03-09')).toEqual({ year: 2025, month: 3, day: 9 });
    expect(parseDate('2025/3/9')).toEqual({ year: 2025, month: 3, day: 9 });
    expect(parseDate('09.03.2025')).toEqual({ year: 2025, month: 3, day: 9 });
    expect(parseDate('2025-02-30')).toBeNull();
    expect(parseDate('2024-02-29')).not.toBeNull();
    expect(parseDate('03/04/2025')).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('parses times, with fractions and 12-hour clocks', () => {
    expect(parseTime('09:05:07')).toEqual({ hour: 9, minute: 5, second: 7 });
    expect(parseTime('9:05')).toEqual({ hour: 9, minute: 5, second: 0 });
    expect(parseTime('09:05:07.250')).toEqual({ hour: 9, minute: 5, second: 7 });
    expect(parseTime('12:00:00 AM')).toEqual({ hour: 0, minute: 0, second: 0 });
    expect(parseTime('12:30 PM')).toEqual({ hour: 12, minute: 30, second: 0 });
    expect(parseTime('1:15:00 pm')).toEqual({ hour: 13, minute: 15, second: 0 });
    expect(parseTime('24:00:00')).toBeNull();
    expect(parseTime('13:00 PM')).toBeNull();
    expect(parseTime('nine')).toBeNull();
  });

  it('parses timestamps with and without an offset', () => {
    expect(parseStamp('2025-03-10 09:00:00')?.offsetMs).toBeNull();
    expect(parseStamp('2025-03-10T09:00:00Z')?.offsetMs).toBe(0);
    expect(parseStamp('2025-03-10T09:00:00+02:00')?.offsetMs).toBe(2 * 3_600_000);
    expect(parseStamp('2025-03-10T09:00:00-0530')?.offsetMs).toBe(-5.5 * 3_600_000);
    expect(parseStamp('2025-03-10T09:00:00.123Z')?.time.second).toBe(0);
    expect(parseStamp('garbage')).toBeNull();
  });

  it('parses durations beyond 24 hours', () => {
    expect(parseDuration('0:00:00')).toBe(0);
    expect(parseDuration('2:30:15')).toBe(9015);
    expect(parseDuration('26:00:00')).toBe(93_600);
    expect(parseDuration('125:59:59')).toBe(125 * 3600 + 59 * 60 + 59);
    expect(parseDuration('1:30')).toBe(5400);
    expect(parseDuration('1:75:00')).toBeNull();
    expect(parseDuration('-1:00:00')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });

  it('parses decimal hours with either separator', () => {
    expect(parseDecimalHours('1.5')).toBe(5400);
    expect(parseDecimalHours('1,25')).toBe(4500);
    expect(parseDecimalHours('0.01')).toBe(36);
    expect(parseDecimalHours('abc')).toBeNull();
  });

  it('parses billable and tags', () => {
    expect(parseBillable('Yes')).toBe(true);
    expect(parseBillable(' yes ')).toBe(true);
    expect(parseBillable('No')).toBe(false);
    expect(parseBillable('')).toBe(false);
    expect(splitTags('a, b,,A , c')).toEqual(['a', 'b', 'c']);
    expect(splitTags('')).toEqual([]);
  });
});

describe('parseRow', () => {
  it('reads a normal row', () => {
    const r = ok({ Tags: 'x, y' });
    expect(iso(r.start)).toBe('2025-03-10T09:00:00.000Z');
    expect(iso(r.stop)).toBe('2025-03-10T10:30:00.000Z');
    expect(r).toMatchObject({ description: 'Work', project: 'Website', client: 'Example Client', billable: true, tags: ['x', 'y'], person: 'person@example.com', durationMismatch: false });
  });

  it('interprets times in the chosen time zone', () => {
    expect(iso(ok({}, 'Europe/Berlin').start)).toBe('2025-03-10T08:00:00.000Z');
    expect(iso(ok({}, 'America/Los_Angeles').start)).toBe('2025-03-10T16:00:00.000Z');
    expect(iso(ok({ 'Start date': '2025-07-10', 'End date': '2025-07-10' }, 'Europe/Berlin').start)).toBe('2025-07-10T07:00:00.000Z');
  });

  it('keeps an entry that crosses midnight', () => {
    const r = ok({ 'Start time': '23:00:00', 'End date': '2025-03-11', 'End time': '01:30:00', Duration: '2:30:00' });
    expect(r.stop - r.start).toBe(2.5 * 3_600_000);
  });

  it('works out the end date when the End date column is empty', () => {
    const r = ok({ 'Start time': '23:00:00', 'End date': '', 'End time': '01:30:00', Duration: '2:30:00' });
    expect(iso(r.stop)).toBe('2025-03-11T01:30:00.000Z');
  });

  it('handles durations over 24 hours', () => {
    const r = ok({ 'Start time': '08:00:00', 'End date': '2025-03-11', 'End time': '10:00:00', Duration: '26:00:00' });
    expect((r.stop - r.start) / 3_600_000).toBe(26);
  });

  it('uses the duration when there is no end', () => {
    const r = ok({ 'End date': '', 'End time': '', Duration: '3:15:00' });
    expect(iso(r.stop)).toBe('2025-03-10T12:15:00.000Z');
  });

  it('uses the end when there is no duration', () => {
    const r = ok({ Duration: '' });
    expect(iso(r.stop)).toBe('2025-03-10T10:30:00.000Z');
  });

  it('rejects a row with neither', () => {
    const r = parse({ 'End date': '', 'End time': '', Duration: '' });
    expect(r).toEqual({ ok: false, error: 'There is no end time and no duration.' });
  });

  it('keeps the real length across the spring-forward night', () => {
    // Berlin 2025-03-30: 01:30 CET to 03:30 CEST is one hour.
    const r = ok({ 'Start date': '2025-03-30', 'Start time': '01:30:00', 'End date': '2025-03-30', 'End time': '03:30:00', Duration: '1:00:00' }, 'Europe/Berlin');
    expect(r.stop - r.start).toBe(3_600_000);
    expect(iso(r.start)).toBe('2025-03-30T00:30:00.000Z');
    expect(r.durationMismatch).toBe(false);
  });

  it('keeps the real length across the fall-back night', () => {
    // Berlin 2025-10-26: 01:30 CEST to 03:30 CET is three hours.
    const r = ok({ 'Start date': '2025-10-26', 'Start time': '01:30:00', 'End date': '2025-10-26', 'End time': '03:30:00', Duration: '3:00:00' }, 'Europe/Berlin');
    expect(r.stop - r.start).toBe(3 * 3_600_000);
  });

  it('uses the duration to choose between the two 02:30s of the fall-back night', () => {
    // Starts at the second 02:30 (CET) and ends at 03:00 CET, thirty minutes later.
    const second = ok({ 'Start date': '2025-10-26', 'Start time': '02:30:00', 'End date': '2025-10-26', 'End time': '03:00:00', Duration: '0:30:00' }, 'Europe/Berlin');
    expect(second.stop - second.start).toBe(30 * 60_000);
    // Starts at the first 02:30 (CEST) and ends at the second 02:15: 45 minutes.
    const first = ok({ 'Start date': '2025-10-26', 'Start time': '02:30:00', 'End date': '2025-10-26', 'End time': '02:15:00', Duration: '0:45:00' }, 'Europe/Berlin');
    expect(first.stop - first.start).toBe(45 * 60_000);
    expect(iso(first.start)).toBe('2025-10-26T00:30:00.000Z');
  });

  it('flags a mismatch between start/end and duration (wrong zone or edited data)', () => {
    const r = ok({ Duration: '2:00:00' });
    expect(r.durationMismatch).toBe(true);
    expect(r.stop - r.start).toBe(1.5 * 3_600_000);
  });

  it('refuses an end before the start', () => {
    const r = parse({ 'End time': '08:00:00', Duration: '' });
    expect(r).toEqual({ ok: false, error: 'The end is before the start.' });
  });

  it('refuses unreadable dates, times and durations with a message naming the value', () => {
    expect(parse({ 'Start date': '31/12/2025' })).toMatchObject({ ok: false, error: expect.stringContaining('31/12/2025') });
    expect(parse({ 'Start time': 'noon' })).toMatchObject({ ok: false, error: expect.stringContaining('noon') });
    expect(parse({ Duration: 'a while' })).toMatchObject({ ok: false, error: expect.stringContaining('a while') });
    expect(parse({ 'Start date': '' })).toMatchObject({ ok: false });
    expect(parse({ 'Start time': '' })).toMatchObject({ ok: false });
  });

  it('says "not a valid date" for an impossible date', () => {
    expect(parse({ 'Start date': '2025-02-31' })).toMatchObject({ ok: false, error: expect.stringContaining('is not a valid date') });
  });

  it('ignores a client when there is no project', () => {
    expect(ok({ Project: '' }).client).toBe('');
  });

  it('reads combined Start and End timestamps, honouring an offset', () => {
    const m = mapHeaders(['Description', 'Start', 'End']).map;
    const r = parseRow(['x', '2025-03-10T09:00:00+02:00', '2025-03-10T10:00:00+02:00'], m, 'America/New_York', 2);
    expect(r.ok && iso(r.row.start)).toBe('2025-03-10T07:00:00.000Z');
    const plain = parseRow(['x', '2025-03-10 09:00:00', '2025-03-10 10:00:00'], m, 'Europe/Berlin', 2);
    expect(plain.ok && iso(plain.row.start)).toBe('2025-03-10T08:00:00.000Z');
  });

  it('reads decimal duration columns', () => {
    const m = mapHeaders(['Start date', 'Start time', 'Duration (decimal)']).map;
    const r = parseRow(['2025-03-10', '09:00:00', '1,5'], m, 'UTC', 2);
    expect(r.ok && r.row.stop - r.row.start).toBe(5400_000);
  });

  it('reads 12-hour times', () => {
    const r = ok({ 'Start time': '09:00:00 AM', 'End time': '01:30:00 PM', Duration: '4:30:00' });
    expect(r.stop - r.start).toBe(4.5 * 3_600_000);
  });
});
