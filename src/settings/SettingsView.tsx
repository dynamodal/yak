import { useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { isFeatureHidden, useHiddenModules } from '../app/features';
import { SETTINGS_SECTIONS, type SettingsSection } from '../app/nav';
import { SETTINGS_TITLES as TITLES } from '../app/settings-index';
import { useHealth } from '../app/hooks';
import { useNeeds } from '../app/needs';
import { useRoute } from '../app/router';
import { Page, PageHeader } from '../app/ui';
import { cx } from '../app/ui/cx';
import { DevicesSection, useSyncDot } from './DevicesSection';
import { AdvancedSection, DisplaySection, FeaturesSection, HelpSection, NeedsSection, NotesSection, OrganizeSection, PartsSection, PassphraseSection, RecentlyDeletedSection } from './Sections';
import { SharingSection } from './SharingSection';
import { SpacesSection } from './SpacesSection';

type Dot = 'warn';

function Anchor({ slug, title }: { slug: SettingsSection; title: string }) {
  return (
    <a class="st-anchor" href={`#/settings/${slug}`} aria-label={`Link to ${title}`}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
        <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
      </svg>
    </a>
  );
}

/** The one line under a heading: what the section is and where its data is kept. */
const BLURBS: Partial<Record<SettingsSection, string>> = {
  backups: 'Full copies of your data in a folder outside the browser, or a download. They are your files and are not synced.',
  'version-history': 'Earlier versions of your time entries, notes and tasks. Stored in a separate database in this browser; for now each device records its own.',
  'recently-deleted': 'Deleted items you can still bring back. Stored with your data, so they sync with it.',
  mirror: 'Notes and tasks appear as Markdown files, one folder per space, and edits made in other editors (Obsidian, VS Code) come back. Time entries stay in the app. The folder is on this device only.',
  passphrase: 'The passphrase protects encrypted backups and approves devices and shares. It is never stored.',
};

function Section(props: { slug: SettingsSection; children: ComponentChildren; class?: string }) {
  const title = TITLES[props.slug];
  return (
    <section id={`st-${props.slug}`} class={cx('card st-card st-section', props.class)} aria-labelledby={`st-${props.slug}-h`} data-section={props.slug}>
      <h2 id={`st-${props.slug}-h`}>
        {title}
        <Anchor slug={props.slug} title={title} />
      </h2>
      {BLURBS[props.slug] ? (
        <p class="hint st-blurb" data-blurb={props.slug}>
          {BLURBS[props.slug]}
        </p>
      ) : null}
      {props.children}
    </section>
  );
}

/** Scrolls to a section; a chip clicked twice still scrolls, because the address does not change the second time. */
function scrollTo(slug: string | undefined): void {
  const el = slug ? document.getElementById(`st-${slug}`) : null;
  if (el) el.scrollIntoView?.({ block: 'start' });
  else window.scrollTo?.({ top: 0 });
}

/**
 * Settings (F-33): one long single-column page, `#/settings`. A contents row under the title links to each section
 * (`#/settings/<section>` opens the page scrolled to it; `#/settings/<section>/<id>` also opens that row). Sections, in order: Needs you (only
 * while something waits), Backups, Version history, Recently deleted, Passphrase and import, Devices and sync, Spaces, Sharing, Organize, Notes (only while Notes is on), Mirror to a folder (only while Mirror is on), Display, Features, Help, Advanced.
 * Devices, spaces and accounts are rows that open in place; only adding a device and Import have pages of their own.
 */
export function SettingsView() {
  const route = useRoute();
  const needs = useNeeds();
  const warn = useHealth().some((i) => i.level === 'warn');
  const syncDot = useSyncDot();
  const slug = SETTINGS_SECTIONS.find((s) => s === route[1]);
  const target = slug && route[2] ? route[2] : undefined;
  useHiddenModules();
  const notesOn = !isFeatureHidden('notes');
  const mirrorOn = !isFeatureHidden('mirror');
  const sections = SETTINGS_SECTIONS.filter((s) => (s !== 'needs-you' || needs.length > 0) && (s !== 'notes' || notesOn) && (s !== 'mirror' || mirrorOn));
  const dots: Partial<Record<SettingsSection, Dot>> = { 'needs-you': 'warn', backups: warn ? 'warn' : undefined, 'devices-sync': syncDot === 'warn' ? 'warn' : undefined } as Partial<Record<SettingsSection, Dot>>;

  useEffect(() => {
    // A row of the Notes section is a part inside it; the other sections open their rows in place.
    if (slug !== 'notes' || !target) return scrollTo(slug);
    const place = (): boolean => {
      const part = document.getElementById(`section-${target}`);
      part?.scrollIntoView?.({ block: 'start' });
      return !!part;
    };
    place();
    // The part may mount late, and sections above it (unused files) grow after the first scroll: keep it in place until the layout settles or the person scrolls.
    const root = document.querySelector('.st-home') ?? document.body;
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    ro?.observe(root);
    const stop = (): void => ro?.disconnect();
    const timer = window.setTimeout(stop, 3000);
    // Not at once: the key that opened this row (Enter in the palette) is still being handled.
    const arm = window.setTimeout(() => window.addEventListener('keydown', stop, { once: true }), 0);
    window.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('touchmove', stop, { once: true, passive: true });
    return () => {
      stop();
      clearTimeout(timer);
      clearTimeout(arm);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [slug, target]);
  const rowFor = (s: SettingsSection): string | undefined => (slug === s ? target : undefined);

  return (
    <Page width="settings" class="st st-home">
      <PageHeader title="Settings" hideTitle />
      <nav class="st-toc" aria-label="Sections of Settings">
        {sections.map((s) => {
          const dot = dots[s];
          return (
            <a
              key={s}
              class="st-toc-chip"
              href={`#/settings/${s}`}
              data-toc={s}
              onClick={(e) => {
                e.preventDefault();
                if (location.hash !== `#/settings/${s}`) location.hash = `#/settings/${s}`;
                scrollTo(s);
              }}
            >
              {TITLES[s]}
              {dot ? (
                <span class={cx('line-dot', dot)} data-dot={dot} role="img" aria-label="needs attention" />
              ) : null}
            </a>
          );
        })}
      </nav>

      {needs.length > 0 ? (
        <Section slug="needs-you" class="st-needs-card">
          <NeedsSection needs={needs} />
        </Section>
      ) : null}
      <Section slug="backups">
        <PartsSection section="backups" />
      </Section>
      <Section slug="version-history">
        <PartsSection section="version-history" />
      </Section>
      <Section slug="recently-deleted">
        <RecentlyDeletedSection />
      </Section>
      <Section slug="passphrase">
        <PassphraseSection open={slug === 'passphrase' && target === 'manage'} />
      </Section>
      <Section slug="devices-sync">
        <DevicesSection {...(rowFor('devices-sync') ? { target: rowFor('devices-sync') as string } : {})} />
      </Section>
      <Section slug="spaces">
        <SpacesSection {...(rowFor('spaces') ? { target: rowFor('spaces') as string } : {})} />
      </Section>
      <Section slug="sharing">
        <SharingSection {...(rowFor('sharing') ? { target: rowFor('sharing') as string } : {})} />
      </Section>
      <Section slug="organize">
        <OrganizeSection open={slug === 'organize'} />
      </Section>
      {notesOn ? (
        <Section slug="notes">
          <NotesSection />
        </Section>
      ) : null}
      {mirrorOn ? (
        <Section slug="mirror">
          <PartsSection section="mirror" />
        </Section>
      ) : null}
      <Section slug="display">
        <DisplaySection />
      </Section>
      <Section slug="features">
        <FeaturesSection />
      </Section>
      <Section slug="help">
        <HelpSection />
      </Section>
      <Section slug="advanced">
        <AdvancedSection open={slug === 'advanced'} />
      </Section>
    </Page>
  );
}
