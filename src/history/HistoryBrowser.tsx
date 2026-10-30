import { useEffect, useState } from 'preact/hooks';
import { privateDocId, spaceDocId } from '../core/doc-store';
import { type DayCount, dayPoints, historyDays, type Point, pointSummary } from '../core/history/browse';
import { Button } from '../app/ui';
import { historyStore } from './runtime';

const DAYS_PER_PAGE = 14;
const dayLabel = (day: string): string => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const clock = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Days that have changes, newest first; opening a day lists its points. Choosing one calls `onPick` with its time. */
export function HistoryBrowser({ spaceIds, selected, onPick, refresh }: { spaceIds: string[]; selected: number | null; onPick: (ms: number) => void; refresh: number }) {
  const [days, setDays] = useState<DayCount[] | null>(null);
  const [shown, setShown] = useState(DAYS_PER_PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[] | null>(null);
  const docIds = spaceIds.flatMap((id) => [privateDocId(id), spaceDocId(id)]);
  const key = docIds.join('|');

  useEffect(() => {
    let live = true;
    setDays(null);
    void historyDays(historyStore, docIds).then((d) => live && setDays(d));
    return () => {
      live = false;
    };
  }, [key, refresh]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPoints(null);
    void dayPoints(historyStore, docIds, open).then((p) => live && setPoints(p));
    return () => {
      live = false;
    };
  }, [open, key, refresh]);

  if (days === null || days.length === 0) return null;
  return (
    <section class="history-browser" aria-label="Days with changes">
      <h2>Days with changes</h2>
      <ul class="history-days">
        {days.slice(0, shown).map((d) => (
          <li key={d.day}>
            <button type="button" class={`history-day${open === d.day ? ' active' : ''}`} aria-expanded={open === d.day} onClick={() => setOpen(open === d.day ? null : d.day)}>
              {dayLabel(d.day)} <span class="muted">· {d.points === 1 ? '1 point' : `${d.points} points`}</span>
            </button>
            {open === d.day && (
              <ul class="history-points">
                {points === null ? (
                  <li class="empty">Reading the day…</li>
                ) : (
                  points.map((p) => (
                    <li key={p.mark ? `mark:${p.end}` : `${p.docId}:${p.seq}`}>
                      <button type="button" class={`history-point${selected === p.end ? ' active' : ''}`} aria-pressed={selected === p.end} onClick={() => onPick(p.end)}>
                        <span>{clock(p.end)}</span> <span>{pointSummary(p)}</span> <span class="muted">· Recorded on: {p.source}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {days.length > shown && <Button onClick={() => setShown(shown + DAYS_PER_PAGE)}>Show older days</Button>}
    </section>
  );
}
