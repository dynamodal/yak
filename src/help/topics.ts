/** The bundled user guide: Markdown from `docs/user/`, in reading order. Shortcuts and Report are built by the view. */
const files = import.meta.glob('../../docs/user/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface Topic {
  id: string;
  title: string;
  /** Markdown source; empty for the topics the view builds itself. */
  source: string;
}

/** Topic ids in reading order. Ids without a file are built by the view. */
const ORDER = ['getting-started', 'home', 'timer', 'reports', 'notes', 'spaces', 'devices', 'backups', 'browsers', 'obsidian', 'import', 'offline', 'shortcuts', 'privacy', 'report'] as const;

const BUILT: Record<string, string> = { shortcuts: 'Keyboard shortcuts', report: 'Report a problem' };

import { type Change, changeToken, parseChanges } from './changes';

/** The entries of What's new, newest first. */
export function allChanges(): Change[] {
  return parseChanges(sourceOf('changes'));
}

export const latestChange = (): string | undefined => changeToken(allChanges()[0]);

/** The raw source of one file in docs/user. */
function sourceOf(id: string): string {
  return Object.entries(files).find(([path]) => path.endsWith(`/${id}.md`))?.[1] ?? '';
}

export function titleOf(source: string, fallback: string): string {
  return /^#\s+(.+)$/m.exec(source)?.[1]?.trim() ?? fallback;
}

export function allTopics(): Topic[] {
  const sources = new Map(Object.entries(files).map(([path, src]) => [path.replace(/^.*\/(.*)\.md$/, '$1'), src]));
  const known: string[] = [...ORDER];
  // `changes` is the What's new section, shown on its own (see HelpView).
  const extra = [...sources.keys()].filter((id) => !known.includes(id) && id !== 'changes').sort();
  return [...ORDER.slice(0, -1), ...extra, 'report'].map((id) => {
    const source = sources.get(id) ?? '';
    return { id, title: BUILT[id] ?? titleOf(source, id), source };
  });
}
