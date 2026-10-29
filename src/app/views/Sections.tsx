import { isFeatureHidden } from '../features';
import { type SectionPage, sectionsOf } from '../sections';

/** The sections modules registered for a page (`registerSection`), each under its own heading. */
export function Sections({ page, level = 2 }: { page: SectionPage; level?: 2 | 3 }) {
  const H = `h${level}` as 'h2' | 'h3';
  return (
    <>
      {sectionsOf(page)
        .filter((s) => !s.feature || !isFeatureHidden(s.feature))
        .map((s) => (
          <section key={s.id} id={`section-${s.id}`} aria-labelledby={`section-${s.id}-h`}>
            <H id={`section-${s.id}-h`}>{s.title}</H>
            <s.component params={[]} />
          </section>
        ))}
    </>
  );
}
