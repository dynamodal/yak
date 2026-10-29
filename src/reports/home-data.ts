import { useMemo } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { useNow } from '../app/hooks';
import { ratesMap } from '../core/rates';
import { collection } from '../core/schema';
import { buildReport, NO_FILTERS, type Report } from './aggregate';
import { resolveRange } from './dates';
import { type HoursFormat } from './format';
import { type YType, useTypesVersion } from './hooks';
import { loadSource, readHoursFormat, readWeekStart, settingsMap } from './source';

/** This week's report over every space this device keeps, grouped by project; kept current as entries change (Home's two time cards). */
export function useWeekReport(): { report: Report; format: HoursFormat; now: number } {
  const { spaceDocs, privateDocs, spaces: accountSpaces, account } = useApp();
  const now = useNow(30_000);
  const spaces = useMemo(
    () =>
      accountSpaces
        .filter((s) => spaceDocs.has(s.id) && privateDocs.has(s.id))
        .map((s) => ({ spaceId: s.id, name: s.name, doc: spaceDocs.get(s.id) as Y.Doc, privateDoc: privateDocs.get(s.id) as Y.Doc })),
    [accountSpaces, spaceDocs, privateDocs],
  );
  const observed = useMemo(() => {
    const list: YType[] = [];
    for (const s of spaces) list.push(collection(s.privateDoc, 'time_entries'), ratesMap(s.privateDoc), collection(s.doc, 'projects'), collection(s.doc, 'clients'));
    const settings = settingsMap(account);
    if (settings) list.push(settings);
    return list;
  }, [spaces, account]);
  const version = useTypesVersion(observed);
  const source = useMemo(() => loadSource(spaces), [spaces, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekStart = readWeekStart(account);
  const format = readHoursFormat(account);
  const day = new Date(now).toDateString();
  const report = useMemo(
    () => buildReport(source, { now, range: resolveRange('this_week', now, weekStart), weekStart, filters: NO_FILTERS, groupBy: 'project', thenBy: null, multiSpace: spaces.length > 1 }),
    [source, day, weekStart, spaces.length, Math.floor(now / 30_000)], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { report, format, now };
}
