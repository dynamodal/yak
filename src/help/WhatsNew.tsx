import { useEffect, useRef } from 'preact/hooks';
import { Markdown } from './Markdown';
import { type Change, changeToken, markChangesSeen } from './changes';

/** How many entries the section shows. */
const SHOWN = 10;

/** Help › What's new: the latest entries of `docs/user/changes/` and the archive `docs/user/changes.md`. Seeing it clears the dot on the Settings tab. */
export function WhatsNew({ changes }: { changes: Change[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const newest = changeToken(changes[0]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Seen once the section is on screen; without IntersectionObserver, once the page is open.
    if (typeof IntersectionObserver === 'undefined') return markChangesSeen(newest);
    const io = new IntersectionObserver((hits) => hits.some((h) => h.isIntersecting) && (markChangesSeen(newest), io.disconnect()), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [newest]);
  if (changes.length === 0) return <p class="hint">Nothing to show yet.</p>;
  return (
    <div ref={ref}>
      {changes.slice(0, SHOWN).map((c) => (
        <article key={c.id} class="change">
          <h3>
            {c.title || c.id} <span class="muted change-date">{c.id}</span>
          </h3>
          <Markdown source={c.body} />
        </article>
      ))}
    </div>
  );
}
