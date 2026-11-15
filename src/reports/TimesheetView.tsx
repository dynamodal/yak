import { useMemo } from 'preact/hooks';
import { Button } from '../app/ui';
import type { GroupBy, Report } from './aggregate';
import { dayShortLabel } from './dates';
import { Scroll, ColorDot } from './parts';
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
      <span class="rp-name" title={row.label}>
        <span class="rp-name-text">{name}</span>
        {row.space && <span class="rp-sub rp-name-space">{row.space}</span>}
      </span>
    </span>
  );
}

/** The Timesheet layout (#180): hours per day in tenths and the day's note, click to copy; invoice lines per row. */
export function TimesheetView({ report, groupBy, onCopy }: TimesheetViewProps) {
  const sheet = useMemo(() => buildTimesheet(report, groupBy), [report, groupBy]);
  if (sheet.rows.length === 0) return <p class="empty">No time tracked in this range with these filters.</p>;
  const dayTotals = sheet.days.map((_, i) => sheet.rows.reduce((n, r) => n + (r.days[i]?.tenths ?? 0), 0));

  return (
    <>
      <p class="hint">Hours are rounded to 0.1 h per day and row; totals add the rounded days. Click hours or a note to copy it.</p>
      <Scroll label="Timesheet grid">
        <table class="rp-table rp-grid-table rp-ts-grid">
          <caption class="rp-sr">Rounded hours and notes per day</caption>
          <thead>
            <tr>
              <th scope="col">{groupBy === 'client' ? 'Client' : 'Project'}</th>
              {sheet.days.map((d) => (
                <th key={d} scope="col" class="rp-num" title={d}>
                  {dayShortLabel(d)}
                </th>
              ))}
              <th scope="col" class="rp-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  <RowName row={r} />
                </th>
                {r.days.map((d) => (
                  <td key={d.day} class={`rp-num rp-ts-cell${d.tenths === 0 ? ' rp-zero' : ''}`}>
                    <button type="button" class="rp-ts-hours" title="Copy hours" onClick={() => onCopy(formatTenths(d.tenths), `${formatTenths(d.tenths)} h`)}>
                      {formatTenths(d.tenths)}
                    </button>
                    {d.note && (
                      <button type="button" class="rp-ts-note" title={`Copy note: ${d.note}`} onClick={() => onCopy(d.note, `the note for ${d.day}`)}>
                        {d.note}
                      </button>
                    )}
                  </td>
                ))}
                <td class="rp-num rp-total">{formatTenths(r.totalTenths)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {dayTotals.map((t, i) => (
                <td key={sheet.days[i]} class={`rp-num${t === 0 ? ' rp-zero' : ''}`}>{formatTenths(t)}</td>
              ))}
              <td class="rp-num rp-total">{formatTenths(sheet.totalTenths)}</td>
            </tr>
          </tfoot>
        </table>
      </Scroll>

      <h3 class="rp-ts-h">Invoice lines</h3>
      {sheet.rows.map((r) => {
        const lines = invoiceLines(r);
        return (
          <section class="card rp-ts-lines" key={r.key} aria-label={`Invoice lines for ${r.label}`}>
            <div class="row rp-section-head">
              <strong><RowName row={r} /></strong>
              {lines.length > 0 && <Button onClick={() => onCopy(copyAllText(lines), 'all lines')}>Copy all</Button>}
            </div>
            {lines.length === 0 ? (
              <p class="hint">Nothing above 0.0 h in this range.</p>
            ) : (
              <ul class="rp-ts-list">
                {lines.map((l) => (
                  <li key={l.day} class="rp-ts-line">
                    <span class="rp-ts-text">{l.text}</span>
                    <span class="rp-ts-h-val">{l.hours}</span>
                    <Button aria-label={`Copy line ${l.day}`} onClick={() => onCopy(`${l.text}\t${l.hours}`.replace(/[\r\n]+/g, ' '), `the line for ${l.day}`)}>Copy</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
