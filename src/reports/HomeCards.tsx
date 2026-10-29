import './reports.css';
import { HomeCard } from '../app/home-cards';
import { dayKey, dayShortLabel } from './dates';
import { formatDuration, formatPercent } from './format';
import { useWeekReport } from './home-data';

const SHOWN_PROJECTS = 6;
const HEX = /^#[0-9a-f]{3,8}$/i;

/** Home's "This week": the total and a bar per day, with the same numbers as a table for screen readers. */
export function WeekCard() {
  const { report, format, now } = useWeekReport();
  if (report.totals.ms <= 0) return null;
  const buckets = report.chart.buckets;
  const max = buckets.reduce((m, b) => Math.max(m, b.ms), 0);
  const today = dayKey(now);
  const summary = buckets.map((b) => `${dayShortLabel(b.key)} ${formatDuration(b.ms, format)}`).join(', ');
  return (
    <HomeCard id="week" title="This week" link={{ href: '#/time/reports', label: 'Reports' }}>
      <p class="hm-big">{formatDuration(report.totals.ms, format)}</p>
      <p class="hm-sub">{report.totals.billableMs > 0 ? `${formatDuration(report.totals.billableMs, format)} billable` : 'tracked so far'}</p>
      <div class="hm-days" role="img" aria-label={`Hours per day this week: ${summary}`}>
        {buckets.map((b) => (
          <div key={b.key} class="hm-day" data-today={b.key === today ? '' : undefined} aria-hidden="true">
            <div class="hm-day-track">{b.ms > 0 ? <div class="hm-day-bar" style={{ height: `${Math.max((b.ms / max) * 100, 3)}%` }} /> : null}</div>
            <span>{dayShortLabel(b.key).split(' ')[0]}</span>
          </div>
        ))}
      </div>
      <details class="hm-data">
        <summary>Show as a table</summary>
        <table class="hm-table">
          <caption class="visually-hidden">Hours per day this week</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" class="hm-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key}>
                <th scope="row">{b.label}</th>
                <td class="hm-num">{formatDuration(b.ms, format)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </HomeCard>
  );
}

/** Home's "Where the week went": a bar by project (a table, so a screen reader gets the numbers). */
export function ProjectsCard() {
  const { report, format } = useWeekReport();
  const total = report.totals.ms;
  if (total <= 0) return null;
  const groups = report.groups.slice(0, SHOWN_PROJECTS);
  const rest = report.groups.slice(SHOWN_PROJECTS).reduce((a, g) => a + g.ms, 0);
  const max = groups[0]?.ms ?? 1;
  return (
    <HomeCard id="projects" title="Where the week went" link={{ href: '#/time/reports', label: 'Reports' }}>
      <table class="hm-table hm-projects">
        <caption class="visually-hidden">Hours by project this week</caption>
        <thead class="visually-hidden">
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Share</th>
            <th scope="col" class="hm-num">Time</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <th scope="row">
                <div class="hm-name">
                  <span class="hm-dot" style={g.color && HEX.test(g.color) ? { backgroundColor: g.color } : undefined} aria-hidden="true" />
                  <span title={g.label}>{g.label}</span>
                </div>
              </th>
              <td class="hm-bar-cell" aria-hidden="true">
                <div class="hm-bar">
                  <span style={{ width: `${Math.max((g.ms / max) * 100, 2)}%` }} />
                </div>
              </td>
              <td class="hm-num">
                {formatDuration(g.ms, format)} <span class="hm-meta">{formatPercent(g.ms, total)}</span>
              </td>
            </tr>
          ))}
          {rest > 0 ? (
            <tr>
              <th scope="row">
                <div class="hm-name">
                  <span class="hm-dot" aria-hidden="true" />
                  <span>{report.groups.length - SHOWN_PROJECTS} more</span>
                </div>
              </th>
              <td class="hm-bar-cell" aria-hidden="true" />
              <td class="hm-num">
                {formatDuration(rest, format)} <span class="hm-meta">{formatPercent(rest, total)}</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </HomeCard>
  );
}
