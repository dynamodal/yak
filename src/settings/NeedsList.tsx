import { useNow } from '../app/hooks';
import { minutesLeft, type NeedItem } from '../app/needs';

/** Needs you: what waits for an answer, each with the place it is answered (F-33). The section is left out while nothing waits. */
export function NeedsSection(props: { needs: readonly NeedItem[] }) {
  const now = useNow(30_000);
  return (
    <ul class="st-needs" aria-label="Needs you">
      {props.needs.map((n) => (
        <li key={n.id} data-need={n.id} data-tone={n.tone}>
          <span class="st-need-text">
            {n.text}
            {n.expiresAt ? <span class="hint"> · {minutesLeft(n.expiresAt, now)} min left</span> : null}
          </span>
          <a class="btn" href={n.href}>
            {n.action}
          </a>
        </li>
      ))}
    </ul>
  );
}
