import type * as Y from 'yjs';
import { buildIndex } from './note-store';
import { isTaskProps } from './tasks';

/** Where a task opens: in Notes when that feature is on (as always), else on its own route under Tasks (F-33n). */
export function taskHref(id: string, notesHidden: boolean): string {
  return `#/${notesHidden ? 'tasks' : 'notes'}/${encodeURIComponent(id)}`;
}

export const PLAIN_NOTE_TITLE = 'Turn on Notes to open this note';
export const NO_SUCH_TASK_TITLE = 'No task has this name. Turn on Notes to create notes';

/**
 * What a `[[link]]` in a task body does on the task page (Notes off): a task opens, anything else is
 * inert text with this title. `hit` is what the link resolves to, null when it reaches nothing.
 */
export function taskLinkTitle(hit: { isTask: boolean } | null): string | undefined {
  return hit === null ? NO_SUCH_TASK_TITLE : hit.isTask ? undefined : PLAIN_NOTE_TITLE;
}

/** `#/notes/<id>` while Notes is hidden: the task route when the note is a task, else nothing (the shell then lands on the first tab). */
export function notesRouteRedirect(params: readonly string[], spaceDocs: ReadonlyMap<string, Y.Doc>): string[] | undefined {
  const id = params[0];
  if (!id) return undefined;
  for (const doc of spaceDocs.values()) {
    const note = buildIndex(doc).byId.get(id);
    if (note) return isTaskProps(note.parsed.properties) ? ['tasks', id] : undefined;
  }
  return undefined;
}
