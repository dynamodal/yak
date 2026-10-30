import type * as Y from 'yjs';

/** Shared display settings live in the Personal space document's `settings` map. */

export type WeekStart = 'monday' | 'sunday';
/** `decimal` is two places (1.25 h, the original), `decimal1` one, `decimal0` whole hours; `hm` is h:mm. Only the display rounds (#99). */
export type HoursFormat = 'decimal' | 'decimal1' | 'decimal0' | 'hm';

export interface SharedSettings {
  week_start: WeekStart;
  hours_format: HoursFormat;
}

export const DEFAULT_SETTINGS: SharedSettings = { week_start: 'monday', hours_format: 'decimal' };

export function parseWeekStart(value: unknown): WeekStart {
  return value === 'sunday' ? 'sunday' : 'monday';
}

/** `hm` is the stored form; `h:mm` is accepted because the reports module once wrote it. Anything else is two-place decimal. */
export function parseHoursFormat(value: unknown): HoursFormat {
  if (value === 'hm' || value === 'h:mm') return 'hm';
  return value === 'decimal1' || value === 'decimal0' ? value : 'decimal';
}

export function readSettings(doc: Y.Doc | undefined): SharedSettings {
  if (!doc) return DEFAULT_SETTINGS;
  const map = doc.getMap<unknown>('settings');
  return { week_start: parseWeekStart(map.get('week_start')), hours_format: parseHoursFormat(map.get('hours_format')) };
}

export function writeSetting<K extends keyof SharedSettings>(doc: Y.Doc, key: K, value: SharedSettings[K]): void {
  doc.getMap<unknown>('settings').set(key, value);
}

/** Write several settings in one transaction. */
export function writeSettings(doc: Y.Doc, values: Partial<SharedSettings>): void {
  doc.transact(() => {
    for (const [key, value] of Object.entries(values)) doc.getMap<unknown>('settings').set(key, value);
  });
}
