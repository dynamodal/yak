import { useMemo } from 'preact/hooks';
import { Button } from '../app/ui';
import type { GroupBy, Report } from './aggregate';
import { dayLabel } from './dates';
import { ColorDot } from './parts';
import { type TimesheetRow, buildTimesheet, copyAllText, formatTenths, invoiceLines } from './timesheet';

export interface TimesheetViewProps {
  report: Report;
  groupBy: GroupBy;
  /** Copy `text`; `what` names it for the status line. */
  onCopy(text: string, what: string): void;
}

function RowName({ row }: { row: TimesheetRow }) {
  const name = row.space && row.label.endsWith(` · ${row.space}`) ? row.label.slice(0, -(row.space.length + 3)) : row.label;
  return (
    <span class="rp-label">
      <ColorDot color={row.color} />
      <span class="rp-ts-name" title={row.label}>
        {name}
        {row.space && <span class="rp-sub"> · {row.space}</span>}
      </span>
    </span>
  );
}

/** The Timesheet layout (#180): an invoice-style list per project or client, a row per day with tracked time. */
export function TimesheetView({ report, groupBy, onCopy }: TimesheetViewProps) {
  const sheet = useMemo(() => buildTimesheet(report, groupBy), [report, groupBy]);
  if (sheet.rows.length === 0) return <p class="empty">No time tracked in this range with these filters.</p>;

  return (
    <>
      <p class="hint">Hours are rounded to 0.1 h per day and row; totals add the rounded days. Click hours or a note to copy it.</p>
      {sheet.rows.map((r) => {
        const lines = invoiceLines(r);
        const days = r.days.filter((d) => d.ms > 0);
        return (
          <section class="card rp-ts-lines" key={r.key} aria-label={`Timesheet for ${r.label}`}>
            <div class="row rp-ts-head">
              <strong class="rp-ts-title"><RowName row={r} /></strong>
              <span class="rp-ts-sum">Total {formatTenths(r.totalTenths)} h</span>
              {lines.length > 0 && <Button onClick={() => onCopy(copyAllText(lines), 'all lines')}>Copy all</Button>}
            </div>
            <ul class="rp-ts-list">
              {days.map((d) => {
                const hours = formatTenths(d.tenths);
                const line = d.note ? `${d.day} - ${d.note}` : d.day;
                return (
                  <li key={d.day} class={`rp-ts-line${d.tenths === 0 ? ' rp-zero' : ''}`}>
                    <span class="rp-ts-day">{dayLabel(d.day)}</span>
                    {d.note ? (
                      <button type="button" class="rp-ts-note" title="Copy note" onClick={() => onCopy(d.note, `the note for ${d.day}`)}>
                        {d.note}
                      </button>
                    ) : (
                      <span class="rp-ts-note rp-sub">No description</span>
                    )}
                    <button type="button" class="rp-ts-hours" title="Copy hours" onClick={() => onCopy(hours, `${hours} h`)}>
                      {hours}
                    </button>
                    {d.tenths > 0 && (
                      <Button aria-label={`Copy line ${d.day}`} onClick={() => onCopy(`${line}\t${hours}`.replace(/[\r\n]+/g, ' '), `the line for ${d.day}`)}>Copy</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p class="rp-ts-grand">
        <strong>Total for the period</strong>
        <strong class="rp-ts-grand-val">{formatTenths(sheet.totalTenths)} h</strong>
      </p>
    </>
  );
}
