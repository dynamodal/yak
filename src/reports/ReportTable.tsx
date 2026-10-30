import { useState } from 'preact/hooks';
import { Button, IconChevronDown, IconChevronRight } from '../app/ui';
import { type Group, type GroupBy, GROUP_BY_OPTIONS } from './aggregate';
import { dayShortLabel } from './dates';
import { formatAmounts, formatCompact, formatDuration, formatPercent } from './format';
import { ColorDot, Scroll, type ViewData } from './parts';

const nameOf = (g: GroupBy): string => GROUP_BY_OPTIONS.find((o) => o.id === g)?.label ?? g;

export interface ReportTableProps extends ViewData {
  groupBy: GroupBy;
  thenBy: GroupBy | null;
}

/** The one table: a row per group, hours per day (week or month for long ranges), total, share and amount. */
export function ReportTable({ report, format, groupBy, thenBy }: ReportTableProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const total = report.totals.ms;
  const buckets = report.chart.buckets;
  const unit = report.chart.granularity;
  const toggle = (key: string): void => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };
  const tagNote = groupBy === 'tag' || thenBy === 'tag';
  if (total === 0) return <p class="empty">No time tracked in this range with these filters.</p>;

  return (
    <>
      {tagNote && <p class="hint">An entry with several tags counts toward each of its tags, so the rows can add up to more than the total.</p>}
      <Scroll label="Breakdown table">
        <table class="rp-table rp-grid-table">
          <caption class="rp-sr">
            Hours per {unit} by {nameOf(groupBy).toLowerCase()}
            {thenBy ? ` and ${nameOf(thenBy).toLowerCase()}` : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col">{nameOf(groupBy)}</th>
              {buckets.map((b) => (
                <th key={b.key} scope="col" class="rp-num" title={b.label}>
                  {unit === 'day' ? dayShortLabel(b.key) : b.short}
                </th>
              ))}
              <th scope="col" class="rp-num">Total</th>
              <th scope="col" class="rp-num">Share</th>
              <th scope="col" class="rp-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {report.groups.map((g) => (
              <GroupRows key={g.key} group={g} total={total} format={format} open={!collapsed.has(g.key)} onToggle={() => toggle(g.key)} />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {buckets.map((b) => (
                <Cell key={b.key} ms={b.ms} format={format} />
              ))}
              <td class="rp-num rp-total">{formatDuration(total, format)}</td>
              <td class="rp-num" />
              <td class="rp-num">{formatAmounts(report.totals.amounts)}</td>
            </tr>
          </tfoot>
        </table>
      </Scroll>
      <p class="hint">
        Cells are {format === 'hm' ? 'h:mm' : 'decimal hours, rounded'} per {unit}.
      </p>
    </>
  );
}

function Cell({ ms, format }: { ms: number; format: ViewData['format'] }) {
  return <td class={`rp-num${ms === 0 ? ' rp-zero' : ''}`}>{ms === 0 ? <span aria-label="none">–</span> : formatCompact(ms, format)}</td>;
}

/** A truncated name (full text on hover and tap) with the space, when shown, on a muted second line. */
function NameCell({ label, space }: { label: string; space?: string }) {
  const name = space && label.endsWith(` · ${space}`) ? label.slice(0, -(space.length + 3)) : label;
  return (
    <span class="rp-name" title={label}>
      <span class="rp-name-text">{name}</span>
      {space && <span class="rp-sub rp-name-space">{space}</span>}
    </span>
  );
}

function GroupRows(p: { group: Group; total: number; format: ViewData['format']; open: boolean; onToggle(): void }) {
  const { group: g, total, format } = p;
  const hasChildren = g.children.length > 0;
  return (
    <>
      <tr class={hasChildren ? 'rp-parent' : ''}>
        <th scope="row">
          <span class="rp-label">
            {hasChildren && (
              <Button class="rp-toggle" aria-expanded={p.open} aria-label={`${p.open ? 'Collapse' : 'Expand'} ${g.label}`} onClick={p.onToggle}>
                {p.open ? <IconChevronDown /> : <IconChevronRight />}
              </Button>
            )}
            <ColorDot color={g.color} />
            <NameCell label={g.label} space={g.space} />
          </span>
        </th>
        {g.cells.map((c, i) => (
          <Cell key={i} ms={c} format={format} />
        ))}
        <td class="rp-num rp-total">{formatDuration(g.ms, format)}</td>
        <td class="rp-num">
          <span class="rp-share-wrap">
            <span class="rp-share" style={{ width: `${total > 0 ? Math.min(100, (g.ms / total) * 100) : 0}%` }} aria-hidden="true" />
            <span class="rp-share-text">{formatPercent(g.ms, total)}</span>
          </span>
        </td>
        <td class="rp-num">{formatAmounts(g.amounts)}</td>
      </tr>
      {p.open &&
        g.children.map((c) => (
          <tr key={c.key} class="rp-child">
            <th scope="row">
              <span class="rp-label rp-indent">
                <NameCell label={c.label} space={c.space} />
              </span>
            </th>
            {c.cells.map((x, i) => (
              <Cell key={i} ms={x} format={format} />
            ))}
            <td class="rp-num rp-total">{formatDuration(c.ms, format)}</td>
            <td class="rp-num">{formatPercent(c.ms, total)}</td>
            <td class="rp-num">{formatAmounts(c.amounts)}</td>
          </tr>
        ))}
    </>
  );
}
