import { useEffect } from 'preact/hooks';
import { Page, PageHeader } from '../app/ui';
import { ShortcutsCard } from './ShortcutsCard';
import { APP_NAME } from '../constants';
import { Markdown } from './Markdown';
import { WhatsNew } from './WhatsNew';
import { OpenSource } from './OpenSource';
import { ReportForm } from './ReportView';
import { allChanges, allTopics } from './topics';
import { allCommands, formatShortcut, shortcutsOf } from '../app/commands';
import { useOverrides } from '../app/views/CommandHost';

declare const __APP_VERSION__: string | undefined;

/** Generated from the command registry and the person's own bindings, so it never goes stale; the bindings can be changed here. */
function ShortcutList() {
  const overrides = useOverrides();
  const find = allCommands().find((c) => c.id === 'notes.find');
  const findKeys = find ? shortcutsOf(find, overrides) : [];
  return (
    <>
      <p class="hint">
        Shared across your devices. <kbd>Alt P</kbd> opens the command palette, which lists every command, including those without a shortcut. <kbd>Ctrl K</kbd> stays “link” inside a note.{findKeys.length > 0 && <> {findKeys.map((k, i) => <>{i > 0 && ' or '}<kbd>{formatShortcut(k)}</kbd></>)} finds a note.</>}
      </p>
      <ShortcutsCard />
    </>
  );
}

/** The DOM id of a section; the section ids themselves (`about`, `privacy`, …) are what links use. */
const sectionDomId = (id: string): string => `help-${id}`;

function About() {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development';
  return (
    <>
      <p>
        <strong>{APP_NAME}</strong> keeps your time, notes and tasks in your own browser, with optional sync between your own devices.
      </p>
      <p class="hint">Version {version}. Everything is stored on this device; sync is optional.</p>
      <p>
        Found a problem? <a href="#/help/report">Report a problem</a>.
      </p>
    </>
  );
}

function Stands() {
  return (
    <p>
      <strong>{APP_NAME}</strong> stands for <strong>Your Activity Keeper</strong>: it keeps what you did, the hours and the notes, and keeps them yours.
    </p>
  );
}

interface Section {
  id: string;
  title: string;
  body: preact.ComponentChildren;
}

function sections(): Section[] {
  const guide = allTopics()
    .filter((t) => t.id !== 'report')
    .map((t): Section => ({ id: t.id, title: t.title, body: t.id === 'shortcuts' ? <ShortcutList /> : <Markdown source={t.source} /> }));
  const openSource: Section = { id: 'open-source', title: 'Open source', body: <OpenSource /> };
  const whatsNew: Section = { id: 'whats-new', title: "What's new", body: <WhatsNew changes={allChanges()} /> };
  return [{ id: 'about', title: 'About', body: <About /> }, whatsNew, { id: 'stands-for', title: 'What Yak stands for', body: <Stands /> }, ...guide, openSource];
}

/**
 * Help & About: one long page, a table of contents on top (`#/help/<section>` scrolls to the
 * section). "Report a problem" is a page of its own (`#/help/report`) because it has actions.
 */
export function HelpView({ params }: { params: string[] }) {
  const target = params[0];
  const report = target === 'report';
  useEffect(() => {
    if (report) return;
    const el = target ? document.getElementById(sectionDomId(target)) : null;
    if (el) el.scrollIntoView?.({ block: 'start' });
    else window.scrollTo?.(0, 0);
  }, [target, report]);

  if (report) {
    return (
      <Page width="settings" class="st help">
        <PageHeader title="Report a problem" />
        <p>
          <a href="#/help">← Help & About</a>
        </p>
        <ReportForm />
      </Page>
    );
  }
  const all = sections();
  return (
    <Page width="settings" class="st help">
      <PageHeader title="Help & About" />
      <p class="help-report-bar">
        <a class="btn" href="#/help/report">Report a problem</a>
      </p>
      <nav aria-label="Contents" class="help-toc">
        <ul>
          {all.map((s) => (
            <li key={s.id}>
              <a href={`#/help/${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ul>
      </nav>
      {all.map((s) => (
        <section key={s.id} id={sectionDomId(s.id)} class="help-section" aria-labelledby={`${sectionDomId(s.id)}-h`}>
          <h2 id={`${sectionDomId(s.id)}-h`}>{s.title}</h2>
          {s.body}
        </section>
      ))}
    </Page>
  );
}
