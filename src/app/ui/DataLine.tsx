import type { ComponentChildren } from 'preact';
import { cx } from './cx';

export type DataLineTone = 'ok' | 'warn' | 'off';

/**
 * One status row on Settings (F-326, F-33): a coloured dot (ok, warn or off), a label and short
 * text, and the link or action at the end of the same line. It never wraps: the text is cut with an ellipsis.
 */
export function DataLine(props: { id: string; tone: DataLineTone; label: string; text: string; dot?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <p class="data-line" data-line={props.id} data-tone={props.tone}>
      {props.dot ?? <span class={cx('line-dot', props.tone)} aria-hidden="true" />}
      <span class="line-text" title={`${props.label}: ${props.text}`}>
        <strong>{props.label}:</strong> {props.text}
      </span>
      {props.children ? <span class="line-link">{props.children}</span> : null}
    </p>
  );
}
