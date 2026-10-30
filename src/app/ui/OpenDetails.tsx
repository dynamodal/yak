import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { cx } from './cx';

/**
 * A fold that opens in place (`st-open`): the body mounts only while open, so a heavy body costs nothing until it is wanted.
 * `open` opens it from outside (an address naming it); the person can still close it.
 */
export function OpenDetails(props: { summary: ComponentChildren; open?: boolean; onToggle?: (open: boolean) => void; class?: string; id?: string; children: ComponentChildren }) {
  const [shown, setShown] = useState(props.open === true);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (props.open && ref.current) {
      ref.current.open = true;
      setShown(true);
    }
  }, [props.open]);
  return (
    <details class={cx('st-open', props.class)} id={props.id} ref={ref} open={props.open === true} onToggle={(e) => {
        const now = (e.target as HTMLDetailsElement).open;
        setShown(now);
        props.onToggle?.(now);
      }}>
      <summary>{props.summary}</summary>
      {shown ? props.children : null}
    </details>
  );
}
