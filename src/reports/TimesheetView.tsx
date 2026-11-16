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
      <p class="hint">Hours are rounded to 0.1 h per day and row; totals add the rounded days. Every day of the range is listed; click the hours or use the buttons to copy.</p>
      {sheet.rows.map((r) => {
        const lines = invoiceLines(r);
        return (
          <section class="card rp-ts-lines" key={r.key} aria-label={`Timesheet for ${r.label}`}>
            <div class="row rp-ts-head">
              <strong class="rp-ts-title"><RowName row={r} /></strong>
              <span class="rp-ts-sum">Total {formatTenths(r.totalTenths)} h</span>
              {lines.length > 0 && <Button onClick={() => onCopy(copyAllText(lines), 'all lines')}>Copy all</Button>}
            </div>
            <ul class="rp-ts-list">
              {r.days.map((d) => {
                const hours = formatTenths(d.tenths);
                const copyable = d.tenths > 0;
                const dated = d.note ? `${d.day} - ${d.note}` : d.day;
                return (
                  <li key={d.day} class={`rp-ts-line${copyable ? '' : ' rp-zero'}`}>
                    <span class="rp-ts-day">{dayLabel(d.day)}</span>
                    <span class="rp-ts-note">{d.note}</span>
                    {copyable ? (
                      <button type="button" class="rp-ts-hours" title="Copy hours" onClick={() => onCopy(hours, `${hours} h`)}>
                        {hours}
                      </button>
                    ) : (
                      <span class="rp-ts-hours" aria-label={d.ms > 0 ? '0.0, rounds to nothing' : 'nothing tracked'}>{d.ms > 0 ? hours : '–'}</span>
                    )}
                    {copyable && (
                      <span class="rp-ts-btns">
                        <Button aria-label={`Copy description for ${d.day}`} disabled={!d.note} onClick={() => onCopy(d.note, `the description for ${d.day}`)}>Copy description</Button>
                        <Button aria-label={`Copy description and date for ${d.day}`} onClick={() => onCopy(dated.replace(/[\r\n]+/g, ' '), `the description and date for ${d.day}`)}>Copy description and date</Button>
                      </span>
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
