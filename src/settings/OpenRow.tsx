import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { useYVersion } from '../app/hooks';
import { decided, keeps, keepsMap, setKeeps } from '../core/keeps';

/**
 * Which row of a section is open (F-33): one at a time, the row the address names (`#/settings/<section>/<id>`) at first.
 * A row opens in place; nothing about it is a page of its own.
 */
export function useOpenRow(target: string | undefined): [string | undefined, (id: string | undefined) => void] {
  const [open, setOpen] = useState<string | undefined>(target);
  useEffect(() => {
    if (target) setOpen(target);
  }, [target]);
  return [open, setOpen];
}

/** A row that opens in place: a button with the name and one line about it, the body below it while open. */
export function OpenRow(props: {
  id: string;
  open: boolean;
  onToggle(open: boolean): void;
  title: ComponentChildren;
  sub?: ComponentChildren;
  /** Something to look at in the closed row (a dot or a chip). */
  aside?: ComponentChildren;
  /** Data attributes for tests and links: `{ 'data-space': id }`. */
  attrs?: Record<string, string>;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // The row the address names comes into view once.
  const first = useRef(props.open);
  useEffect(() => {
    if (first.current) ref.current?.scrollIntoView?.({ block: 'nearest' });
    first.current = false;
  }, []);
  const body = `st-row-body-${props.id}`;
  return (
    <li class="st-row" ref={ref} data-open={props.open ? '' : undefined} {...(props.attrs ?? {})}>
      <button type="button" class="st-row-head" aria-expanded={props.open} aria-controls={props.open ? body : undefined} onClick={() => props.onToggle(!props.open)}>
        <span class="st-row-main">
          <span class="st-row-title">{props.title}</span>
          {props.sub ? <span class="hint st-row-sub">{props.sub}</span> : null}
        </span>
        {props.aside}
        <span class="st-chevron" aria-hidden="true" />
      </button>
      {props.open ? (
        <div class="st-row-body" id={body}>
          {props.children}
        </div>
      ) : null}
    </li>
  );
}

/**
 * One toggle chip: whether a device keeps a space. A real checkbox in a pill, so keyboard and screen readers work as before;
 * not decided yet shows as indeterminate. The device row and the space row both write the same `keeps` record, so they never disagree.
 */
export function KeepChip(props: { deviceId: string; spaceId: string; who: string; spaceName: string; label: string }) {
  const { account } = useApp();
  useYVersion(keepsMap(account) as unknown as Y.AbstractType<unknown>);
  const on = keeps(account, props.deviceId, props.spaceId);
  const undecided = !decided(account, props.deviceId, props.spaceId);
  return (
    <label class="st-keep-chip" data-on={on ? '' : undefined} data-undecided={undecided ? '' : undefined}>
      <input type="checkbox" checked={on} indeterminate={undecided} aria-label={`${props.who} keeps ${props.spaceName}`} onChange={(e) => setKeeps(account, props.deviceId, props.spaceId, (e.target as HTMLInputElement).checked)} />
      <span>{props.label}</span>
    </label>
  );
}

/** "Personal, Work" for the spaces a device keeps, "nothing yet" for none. */
export function keptNames(spaces: readonly { id: string; name: string }[], has: (spaceId: string) => boolean): string {
  const names = spaces.filter((s) => has(s.id)).map((s) => s.name);
  return names.length > 0 ? names.join(', ') : 'nothing yet';
}
