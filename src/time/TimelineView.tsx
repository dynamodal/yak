import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { rememberTimelineSpan, savedTimelineSpan, type TimelineSpan } from '../app/timer-views';
import { useNow } from '../app/hooks';
import { Button, IconChevronLeft, IconChevronRight, useMedia } from '../app/ui';
import { addDays, dayKey, startOfDay } from './dates';
import { formatDayLabel } from './format';
import { type AllTime, useSpaceName } from './hooks';
import { weekRange } from './stats';
import {
  clockText,
  cutByDay,
  drawnPosition,
  entryBlocks,
  findGaps,
  findOverlaps,
  layoutLanes,
  minutesText,
  spansTouching,
  type Gap,
  type Overlap,
  type TimelineBlock,
  wallMinutes,
} from './timeline';

/** Pixels per hour on the grid; a minute is a pixel, so the shortest gap (15 minutes) is tall enough for its label. */
const HOUR_PX = 60;
const DEFAULT_TOP_HOUR = 8;
const LEAD_MINUTES = 30;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };

function rangeLabel(from: number, to: number, span: TimelineSpan): string {
  if (span === 'day') return new Date(from).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${new Date(from).toLocaleDateString(undefined, opts)} – ${new Date(addDays(to, -1)).toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
}

interface Found {
  gaps: Gap[];
  overlaps: (Overlap & { day: string; dayStart: number; start: number; end: number })[];
}

/**
 * The Calendar segment of the Time page (#68, read only): Day or Week, a 24-hour grid of the entries of the spaces
 * the filter shows, gaps dashed and labelled, overlaps hatched, and the same findings as a list under the grid.
 */
export default function TimelineView({ all }: { all: AllTime }) {
  const narrow = useMedia('(max-width: 40rem)');
  const [span, setSpanState] = useState<TimelineSpan>(() => savedTimelineSpan() ?? (narrow ? 'day' : 'week'));
  const [anchor, setAnchor] = useState(() => Date.now());
  const now = useNow(30_000);
  const spaceName = useSpaceName();
  const { weekStart } = all.data;
  const setSpan = (s: TimelineSpan): void => {
    setSpanState(s);
    rememberTimelineSpan(s);
  };
  const range = span === 'day' ? { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) } : weekRange(anchor, weekStart);
  const step = span === 'day' ? 1 : 7;
  const days = useMemo(() => {
    const out: number[] = [];
    for (let d = range.from; d < range.to; d = addDays(d, 1)) out.push(d);
    return out;
  }, [range.from, range.to]);

  const entryById = useMemo(() => new Map(all.entries.map((e) => [e.id, e])), [all.entries]);
  const describe = (id: string): string => entryById.get(id)?.description || '(no description)';

  const blocks = useMemo(
    () =>
      entryBlocks(all.entries, range, now, (e) => {
        const project = e.project_id ? (e.spaceId && all.slices.get(e.spaceId)?.projectById.get(e.project_id)) || all.data.projectById.get(e.project_id) : undefined;
        return { title: e.description || '(no description)', subtitle: project?.name, color: project?.color ?? null };
      }),
    [all.entries, all.slices, all.data, range.from, range.to, now],
  );
  const found = useMemo<Found>(() => {
    const spans = spansTouching(all.entries, range, now);
    const overlaps = cutByDay(findOverlaps(spans), range).map((p) => ({ ...p.source, day: p.day, dayStart: p.dayStart, start: p.start, end: p.end }));
    return { gaps: findGaps(spans, range, now), overlaps };
  }, [all.entries, range.from, range.to, now]);
  const overlapping = useMemo(() => new Set(found.overlaps.flatMap((o) => [`${o.firstId}@${o.day}`, `${o.secondId}@${o.day}`])), [found]);

  // Open scrolled to just before the first entry of the range (08:00 when there is none).
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const firstMinute = blocks.length ? Math.min(...blocks.map((b) => wallMinutes(b.start, startOfDay(b.start)))) : DEFAULT_TOP_HOUR * 60;
    el.scrollTop = Math.max(0, ((blocks.length ? firstMinute - LEAD_MINUTES : firstMinute) / 60) * HOUR_PX);
  }, [range.from, span]);

  const filtered = all.multi && all.filter !== 'all';
  const isCurrent = range.from <= now && now < range.to;
  const label = (dayStart: number): string => formatDayLabel(dayStart, now);

  return (
    <div class="tlg-page">
      <div class="row week-nav" role="group" aria-label="Calendar">
        <div class="seg" role="group" aria-label="Calendar span">
          {(['day', 'week'] as const).map((s) => (
            <button type="button" key={s} class={s === span ? 'active' : ''} aria-pressed={s === span} onClick={() => setSpan(s)}>
              {s === 'day' ? 'Day' : 'Week'}
            </button>
          ))}
        </div>
        <Button aria-label={span === 'day' ? 'Previous day' : 'Previous week'} onClick={() => setAnchor(addDays(range.from, -step))}>
          <IconChevronLeft /> Previous
        </Button>
        <strong class="week-label" aria-live="polite">
          {rangeLabel(range.from, range.to, span)}
        </strong>
        <Button aria-label={span === 'day' ? 'Next day' : 'Next week'} onClick={() => setAnchor(addDays(range.from, step))}>
          Next <IconChevronRight />
        </Button>
        <Button disabled={isCurrent} onClick={() => setAnchor(Date.now())}>
          Today
        </Button>
      </div>

      <div class="tlg-scroll" ref={scroller} tabIndex={0} role="region" aria-label="Calendar grid">
        <div class="tlg" style={{ '--tlg-cols': days.length, '--tlg-hour': `${HOUR_PX}px` }}>
          <div class="tlg-head">
            <span class="tlg-gutter" />
            {days.map((d) => (
              <span key={d} class={`tlg-dayhead${dayKey(d) === dayKey(now) ? ' today' : ''}`}>
                {span === 'week' ? new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) : new Date(d).toLocaleDateString(undefined, WEEKDAY)}
              </span>
            ))}
          </div>
          <div class="tlg-body">
            <div class="tlg-axis" aria-hidden="true">
              {HOURS.map((h) => (
                <span key={h} class="tlg-hour" style={{ top: `${h * HOUR_PX}px` }}>
                  {String(h).padStart(2, '0')}:00
                </span>
              ))}
            </div>
            {days.map((d) => (
              <DayColumn key={d} dayStart={d} blocks={blocks} found={found} overlapping={overlapping} now={now} label={label(d)} />
            ))}
          </div>
        </div>
      </div>

      <section class="tlg-findings" aria-labelledby="tlg-findings-title">
        <h2 id="tlg-findings-title" class="section-head">
          Gaps and overlaps
        </h2>
        {filtered && <p class="muted tlg-note">Showing one space: overlaps with entries in other spaces are hidden.</p>}
        {found.gaps.length === 0 && found.overlaps.length === 0 ? (
          <p class="empty">No gaps or overlaps in this {span}.</p>
        ) : (
          <ul class="tlg-list">
            {[
              ...found.gaps.map((g) => ({ at: g.start, key: `g${g.start}`, text: gapText(g, label(g.dayStart), span) })),
              ...found.overlaps.map((o) => ({
                at: o.start,
                key: `o${o.firstId}${o.secondId}${o.start}`,
                text: `${span === 'week' ? `${label(o.dayStart)}: ` : ''}Overlap ${clockText(o.start)}–${clockText(o.end)} (${minutesText(o.end - o.start)}): ${describe(o.firstId)} and ${describe(o.secondId)}${all.multi ? ` (${spaceOf(o.firstId)}, ${spaceOf(o.secondId)})` : ''}`,
              })),
            ]
              .sort((a, b) => a.at - b.at)
              .map((f) => (
                <li key={f.key}>{f.text}</li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );

  function spaceOf(id: string): string {
    const sid = entryById.get(id)?.spaceId;
    return sid ? spaceName(sid) : '';
  }
}

function gapText(g: Gap, dayLabelText: string, span: TimelineSpan): string {
  return `${span === 'week' ? `${dayLabelText}: ` : ''}Gap ${clockText(g.start)}–${clockText(g.end)} (${minutesText(g.end - g.start)})`;
}

function DayColumn({ dayStart, blocks, found, overlapping, now, label }: { dayStart: number; blocks: TimelineBlock[]; found: Found; overlapping: Set<string>; now: number; label: string }) {
  const key = dayKey(dayStart);
  const own = blocks.filter((b) => dayKey(b.start) === key);
  const placed = layoutLanes(own, dayStart);
  const gaps = found.gaps.filter((g) => g.day === key);
  const overlaps = found.overlaps.filter((o) => o.day === key);
  const px = (minutes: number): number => (minutes / 60) * HOUR_PX;
  return (
    <div class="tlg-col" role="group" aria-label={label}>
      {gaps.map((g) => {
        const pos = drawnPosition(g.start, g.end, dayStart);
        return (
          <div key={g.start} class="tlg-gap" style={{ top: `${px(pos.top)}px`, height: `${px(pos.bottom - pos.top)}px` }}>
            <span>{minutesText(g.end - g.start)} gap</span>
          </div>
        );
      })}
      {placed.map((p) => {
        const b = p.item;
        const lanes = p.lanes;
        const finding = overlapping.has(`${b.id}@${key}`) ? 'Overlaps another entry. ' : '';
        const name = `${b.title}${b.subtitle ? `, ${b.subtitle}` : ''}. ${clockText(b.start)} to ${b.running ? 'now' : clockText(b.end)}, ${minutesText(b.end - b.start)}${b.running ? ', running' : ''}. ${finding}`.trim();
        return (
          <div
            key={`${b.id}${b.start}`}
            class={`tlg-block${b.running ? ' running' : ''}`}
            tabIndex={0}
            role="group"
            aria-label={name}
            style={{
              top: `${px(p.top)}px`,
              height: `${Math.max(px(p.bottom - p.top), 4)}px`,
              left: `${(p.lane / lanes) * 100}%`,
              width: `${100 / lanes}%`,
              '--tlg-color': b.color ?? 'var(--muted)',
            }}
          >
            <span class="tlg-title">{b.title}</span>
            {b.subtitle && <span class="tlg-sub">{b.subtitle}</span>}
          </div>
        );
      })}
      {overlaps.map((o) => {
        const pos = drawnPosition(o.start, o.end, dayStart);
        return (
          <div key={`${o.firstId}${o.secondId}${o.start}`} class="tlg-overlap" style={{ top: `${px(pos.top)}px`, height: `${Math.max(px(pos.bottom - pos.top), 4)}px` }} aria-hidden="true">
            <span>Overlap</span>
          </div>
        );
      })}
      {startOfDay(now) === dayStart && <div class="tlg-now" style={{ top: `${px(wallMinutes(now, dayStart))}px` }} aria-hidden="true" />}
    </div>
  );
}
