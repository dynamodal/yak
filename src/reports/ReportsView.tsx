import { type VNode, cloneElement } from 'preact';
import { testMode } from '../core/test-build';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import type { ViewProps } from '../app/registry';
import { Button, IconChevronLeft, IconChevronRight, Page } from '../app/ui';
import { useSpaceFilter } from '../app/space-filter';
import { TimerPageHeader } from '../app/views/TimerPageHeader';
import { ratesMap } from '../core/rates';
import { collection } from '../core/schema';
import {
  type Filters,
  type GroupBy,
  GROUP_BY_OPTIONS,
  NONE,
  NO_FILTERS,
  buildReport,
  filterChoices,
  hasFilters,
} from './aggregate';
import { type CustomRange, type RangePreset, RANGE_PRESETS, canStepNext, dayKey, presetFor, resolveRange, stepRange, toCustom } from './dates';
import { DetailedView } from './DetailedView';
import { copyText, csvFileName, downloadText } from './browser-io';
import { detailCsv, summaryMarkdown } from './export';
import { formatAmounts, rangeLabel } from './format';
import { type YType, useTypesVersion } from './hooks';
import { loadSource, readHoursFormat, readWeekStart, settingsMap } from './source';
import { BarChart } from './BarChart';
import { ReportTable } from './ReportTable';
import { Disclosure, Totals } from './parts';
import { seedSpace, type SeedData } from './testhook';

/** The sections of the page; old links (`#/reports/detailed`, `#/reports/weekly`) open it at one. */
type Section = 'table' | 'detailed';

function sectionFrom(params: string[]): Section | null {
  return params[0] === 'detailed' ? 'detailed' : params[0] === 'weekly' || params[0] === 'summary' ? 'table' : null;
}

const FOLD_KEY = 'app-reports-folds';

/** Folded or open per section, remembered on this device only. */
function useFold(id: string, initial: boolean): [boolean, (open: boolean) => void] {
  const read = (): boolean => {
    try {
      const saved = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') as Record<string, boolean>;
      return saved[id] ?? initial;
    } catch {
      return initial;
    }
  };
  const [open, set] = useState(read);
  const setOpen = (value: boolean): void => {
    set(value);
    try {
      const saved = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') as Record<string, boolean>;
      localStorage.setItem(FOLD_KEY, JSON.stringify({ ...saved, [id]: value }));
    } catch {
      // ignore
    }
  };
  return [open, setOpen];
}

const RANGE_KEY = 'app-reports-range';
const DEFAULT_PRESET: RangePreset = 'this_week';

interface SavedRange {
  preset: RangePreset;
  custom: CustomRange;
}

/** The range used last on this device (R-335): UI-only, so storage that is missing or unreadable just means "This week". */
function readRange(today: string): SavedRange {
  const fresh = { preset: DEFAULT_PRESET, custom: { from: today, to: today } };
  try {
    const raw = JSON.parse(localStorage.getItem(RANGE_KEY) ?? 'null') as Partial<SavedRange> | null;
    if (!raw || !RANGE_PRESETS.some((p) => p.id === raw.preset)) return fresh;
    const c = raw.custom;
    const custom = c && typeof c.from === 'string' && typeof c.to === 'string' ? { from: c.from, to: c.to } : fresh.custom;
    return { preset: raw.preset as RangePreset, custom };
  } catch {
    return fresh;
  }
}

function writeRange(value: SavedRange): void {
  try {
    localStorage.setItem(RANGE_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function ReportsView({ params }: ViewProps) {
  const { spaceDocs, privateDocs, spaces: accountSpaces, account } = useApp();
  const target = sectionFrom(params);
  const [chartOpen, setChartOpen] = useFold('chart', true);
  const [detailOpen, setDetailOpen] = useFold('detailed', false);
  const [controlsOpen, setControlsOpen] = useState(false);

  // The one space filter of the Timer page (header control); an id this device no longer keeps counts as all spaces.
  const [storedFilter] = useSpaceFilter();
  const filter = accountSpaces.some((s) => s.id === storedFilter) ? storedFilter : 'all';
  const today = dayKey(Date.now());
  const [saved, setSaved] = useState(() => readRange(today));
  const { preset, custom } = saved;
  const setPreset = (p: RangePreset): void => setSaved((r) => ({ ...r, preset: p }));
  const setCustom = (c: CustomRange): void => setSaved((r) => ({ ...r, custom: c }));
  useEffect(() => writeRange(saved), [saved]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [thenBy, setThenBy] = useState<GroupBy | ''>('');
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const [fallbackText, setFallbackText] = useState('');


  // The documents in scope, and the Yjs maps whose changes should re-render the report.
  const spaces = useMemo(
    () =>
      accountSpaces.filter((s) => (filter === 'all' ? spaceDocs.has(s.id) : s.id === filter)).map((s) => ({
        spaceId: s.id,
        name: s.name,
        doc: spaceDocs.get(s.id) as Y.Doc,
        privateDoc: privateDocs.get(s.id) as Y.Doc,
      })),
    [filter, spaceDocs, privateDocs, accountSpaces],
  );
  const observed = useMemo(() => {
    const list: YType[] = [];
    for (const s of spaces) {
      list.push(collection(s.privateDoc, 'time_entries'), ratesMap(s.privateDoc), collection(s.doc, 'projects'), collection(s.doc, 'clients'));
    }
    const settings = settingsMap(account);
    if (settings) list.push(settings);
    return list;
  }, [spaces, account]);
  const version = useTypesVersion(observed);

  const source = useMemo(() => loadSource(spaces), [spaces, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const format = readHoursFormat(account);
  const weekStart = readWeekStart(account);
  const multiSpace = spaces.length > 1;
  const choices = useMemo(() => filterChoices(source, multiSpace), [source, multiSpace]);

  // Filter values name records of one space, so they reset when the spaces in scope change.
  useEffect(() => {
    setFilters((f) => (f.client || f.project ? { ...f, client: null, project: null } : f));
  }, [filter]);

  const thenEffective: GroupBy | null = thenBy && thenBy !== groupBy ? thenBy : null;
  const range = useMemo(() => resolveRange(preset, now, weekStart, custom), [preset, dayKey(now), weekStart, custom]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useMemo(
    () => buildReport(source, { now, range, weekStart, filters, groupBy, thenBy: thenEffective, multiSpace }),
    [source, now, range, weekStart, filters, groupBy, thenEffective, multiSpace],
  );

  // Keep running entries counting up, and pick up a new day when the tab returns to the foreground.
  const hasRunning = report.hasRunning;
  useEffect(() => {
    const tick = (): void => setNow(Date.now());
    const timer = hasRunning ? setInterval(tick, 30_000) : undefined;
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, [hasRunning]);

  // An old link (`#/reports/detailed`) opens the page at that section.
  useEffect(() => {
    if (!target) return;
    if (target === 'detailed') setDetailOpen(true);
    document.getElementById(target === 'detailed' ? 'rp-detailed' : 'rp-table')?.scrollIntoView?.();
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  // Test hook for the browser test; only with `?test` in the URL.
  useEffect(() => {
    if (!testMode()) return;
    (window as unknown as { __reports: unknown }).__reports = {
      // Tests name spaces by the first layout's ids (`personal`); find the space of that name.
      seed: (name: string, data: SeedData) => {
        const id = accountSpaces.find((s) => s.storedName.toLowerCase() === name.toLowerCase())?.id ?? name;
        const doc = spaceDocs.get(id);
        if (doc) seedSpace(doc, data, privateDocs.get(id) ?? doc);
      },
      setHoursFormat: (value: string) => settingsMap(account)?.set('hours_format', value),
    };
  }, [spaceDocs, privateDocs, account, accountSpaces]);

  const setFilter = (patch: Partial<Filters>): void => setFilters((f) => ({ ...f, ...patch }));
  const spaceText = filter === 'all' ? 'All spaces' : (accountSpaces.find((s) => s.id === filter)?.name ?? filter);
  const filterText = describeFilters(filters, choices);
  const presetLabel = RANGE_PRESETS.find((p) => p.id === preset)?.label ?? '';
  const groupLabel = GROUP_BY_OPTIONS.find((o) => o.id === groupBy)?.label ?? '';
  const thenLabel = thenEffective ? `, then ${GROUP_BY_OPTIONS.find((o) => o.id === thenEffective)?.label}` : '';
  const nFilters = filterText.length;
  // The collapsed form in one line; opening it shows every control.
  const controlsLine = [preset === 'custom' ? `${custom.from} to ${custom.to}` : presetLabel, spaceText, `By ${groupLabel.toLowerCase()}${thenLabel.toLowerCase()}`, ...(nFilters ? [`${nFilters} filter${nFilters === 1 ? '' : 's'}`] : [])].join(' · ');

  // Previous / next period (#277): by the period's own length; a result that equals a preset is that preset again.
  const step = (direction: -1 | 1): void => {
    const next = stepRange(range, direction);
    setSaved({ preset: presetFor(next, now, weekStart), custom: toCustom(next) });
  };
  const canNext = canStepNext(range, now);
  const offDefault = preset !== DEFAULT_PRESET;

  const doCopy = async (): Promise<void> => {
    const md = summaryMarkdown({
      rangeText: rangeLabel(range),
      totals: report.totals,
      groups: report.groups,
      groupBy,
      thenBy: thenEffective,
      format,
      filterText,
      spaceText,
    });
    if (await copyText(md)) {
      setFallbackText('');
      setNotice('Copied the summary as Markdown.');
    } else {
      setFallbackText(md);
      setNotice('The browser blocked copying. Select the text below and copy it.');
    }
  };

  const doCsv = (): void => {
    const rows = [...report.rows].sort((a, b) => a.startMs - b.startMs);
    downloadText(csvFileName(range), detailCsv(rows, source.spaceNames), 'text/csv;charset=utf-8', true);
    setNotice(`Downloaded ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} as CSV.`);
  };

  return (
    <Page width="workspace" class="rp">
      <TimerPageHeader title="Reports" active="reports" />
      <div class="row rp-nav" role="group" aria-label="Report period">
        <Button aria-label="Previous period" onClick={() => step(-1)}>
          <IconChevronLeft /> Previous
        </Button>
        <strong class="rp-range" aria-live="polite">
          <span class={offDefault ? 'rp-pill off' : 'rp-pill'}>{rangeLabel(range)}</span>
        </strong>
        <Button aria-label="Next period" disabled={!canNext} onClick={() => step(1)}>
          Next <IconChevronRight />
        </Button>
        {offDefault && (
          <Button class="rp-back" aria-label="Back to this week" onClick={() => setPreset(DEFAULT_PRESET)}>
            This week <span aria-hidden="true">×</span>
          </Button>
        )}
      </div>
      <Disclosure id="controls" title={controlsLine} open={controlsOpen} onToggle={setControlsOpen} heading={false}>
      <form class="rp-controls card" aria-label="Report settings" onSubmit={(e) => e.preventDefault()}>
        <Field label="Range">
          <select value={preset} onChange={(e) => {
              const next = (e.target as HTMLSelectElement).value as RangePreset;
              // Custom starts from the range on screen, so From and To are never a surprise.
              setSaved({ preset: next, custom: next === 'custom' ? toCustom(range) : custom });
            }}>
            {RANGE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Field>
        {preset === 'custom' && (
          <>
            <Field label="From">
              <input type="date" value={custom.from} onInput={(e) => setCustom({ ...custom, from: (e.target as HTMLInputElement).value })} />
            </Field>
            <Field label="To">
              <input type="date" value={custom.to} onInput={(e) => setCustom({ ...custom, to: (e.target as HTMLInputElement).value })} />
            </Field>
          </>
        )}
        <Field label="Client">
          <select value={filters.client ?? ''} onChange={(e) => setFilter({ client: valueOrNull(e) })}>
            <option value="">Any client</option>
            <option value={NONE}>No client</option>
            {choices.clients.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Project">
          <select value={filters.project ?? ''} onChange={(e) => setFilter({ project: valueOrNull(e) })}>
            <option value="">Any project</option>
            <option value={NONE}>No project</option>
            {choices.projects.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Tag">
          <select value={filters.tag ?? ''} onChange={(e) => setFilter({ tag: valueOrNull(e) })}>
            <option value="">Any tag</option>
            <option value={NONE}>No tags</option>
            {choices.tags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Billable">
          <select value={filters.billable} onChange={(e) => setFilter({ billable: (e.target as HTMLSelectElement).value as Filters['billable'] })}>
            <option value="all">All entries</option>
            <option value="billable">Billable</option>
            <option value="non-billable">Not billable</option>
          </select>
        </Field>
        <Field label="Description contains">
          <input type="search" value={filters.text} onInput={(e) => setFilter({ text: (e.target as HTMLInputElement).value })} />
        </Field>
        <Field label="Group by">
          <select value={groupBy} onChange={(e) => setGroupBy((e.target as HTMLSelectElement).value as GroupBy)}>
            {GROUP_BY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Then by">
          <select value={thenEffective ?? ''} onChange={(e) => setThenBy((e.target as HTMLSelectElement).value as GroupBy | '')}>
            <option value="">Nothing</option>
            {GROUP_BY_OPTIONS.filter((o) => o.id !== groupBy).map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </Field>
        {hasFilters(filters) && (
          <div class="rp-field rp-reset">
            <Button onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>
          </div>
        )}
      </form>
      </Disclosure>

      <p class="hint" role="status">{notice}</p>
      <Totals report={report} format={format} />

      <Disclosure id="chart" title="Chart" open={chartOpen} onToggle={setChartOpen}>
        {report.totals.ms === 0 ? (
          <p class="empty">No time tracked in this range with these filters.</p>
        ) : (
          <section class="card rp-card" aria-label="Hours chart">
            <BarChart buckets={report.chart.buckets} granularity={report.chart.granularity} format={format} rangeText={rangeLabel(range)} />
          </section>
        )}
      </Disclosure>

      <section class="rp-section" id="rp-table" aria-labelledby="rp-table-h">
        <div class="row rp-section-head">
          <h2 id="rp-table-h">
            By {GROUP_BY_OPTIONS.find((o) => o.id === groupBy)?.label.toLowerCase()}
            {thenEffective ? `, then ${GROUP_BY_OPTIONS.find((o) => o.id === thenEffective)?.label.toLowerCase()}` : ''}
          </h2>
          <span class="row">
            <Button onClick={() => void doCopy()}>Copy as Markdown</Button>
            <Button onClick={doCsv}>Download CSV</Button>
          </span>
        </div>
        {fallbackText ? <textarea class="rp-fallback" readOnly rows={8} aria-label="Markdown summary" value={fallbackText} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} /> : null}
        <ReportTable report={report} format={format} groupBy={groupBy} thenBy={thenEffective} />
      </section>

      <Disclosure id="detailed" title="Entries" open={detailOpen} onToggle={setDetailOpen}>
        <DetailedView report={report} format={format} />
      </Disclosure>
      <p class="hint rp-foot">
        Running timers count up to now. Weeks start on {weekStart === 'sunday' ? 'Sunday' : 'Monday'}; days follow this device&apos;s time zone. Amounts are hours × the project rate for billable entries, per currency.
        {report.totals.ms > 0 ? ` Total amount: ${formatAmounts(report.totals.amounts)}.` : ''}
      </p>
    </Page>
  );
}

function valueOrNull(e: Event): string | null {
  const v = (e.target as HTMLSelectElement).value;
  return v === '' ? null : v;
}

function Field({ label, children }: { label: string; children: VNode }) {
  const id = `rp-f-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div class="rp-field">
      <label for={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}

function describeFilters(f: Filters, c: ReturnType<typeof filterChoices>): string[] {
  const out: string[] = [];
  if (f.client) out.push(`Client: ${f.client === NONE ? 'none' : (c.clients.find((x) => x.key === f.client)?.label ?? f.client)}`);
  if (f.project) out.push(`Project: ${f.project === NONE ? 'none' : (c.projects.find((x) => x.key === f.project)?.label ?? f.project)}`);
  if (f.tag) out.push(`Tag: ${f.tag === NONE ? 'none' : f.tag}`);
  if (f.billable !== 'all') out.push(f.billable === 'billable' ? 'Billable only' : 'Not billable only');
  if (f.text.trim()) out.push(`Description contains "${f.text.trim()}"`);
  return out;
}
