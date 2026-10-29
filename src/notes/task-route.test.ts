import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { hiddenRedirect, registerHiddenRedirect, registerView } from '../app/registry';
import { effectiveHidden } from '../app/features';
import { createNote } from './note-store';
import { NO_SUCH_TASK_TITLE, notesRouteRedirect, PLAIN_NOTE_TITLE, taskHref, taskLinkTitle } from './task-route';

const docWith = (...notes: [string, string][]) => {
  const doc = new Y.Doc();
  const ids = notes.map(([path, text]) => createNote(doc, path, text));
  return { doc, ids };
};
const TASK = '---\ntags: [task]\nstatus: open\n---\nWrite it\n';

describe('where a task opens', () => {
  it('in Notes when Notes is on, else under Tasks', () => {
    expect(taskHref('a b', false)).toBe('#/notes/a%20b');
    expect(taskHref('a b', true)).toBe('#/tasks/a%20b');
  });
});

describe('links in a task body when Notes is off', () => {
  it('a task opens, a plain note is inert with the reason, an unknown name is inert too', () => {
    expect(taskLinkTitle({ isTask: true })).toBeUndefined();
    expect(taskLinkTitle({ isTask: false })).toBe('Turn on Notes to open this note');
    expect(PLAIN_NOTE_TITLE).toBe('Turn on Notes to open this note');
    expect(taskLinkTitle(null)).toBe(NO_SUCH_TASK_TITLE);
  });
});

describe('#/notes/<id> with Notes off', () => {
  const { doc, ids } = docWith(['Tasks/Do it.md', TASK], ['Plan.md', '# Plan\n']);
  const docs = new Map([['personal', doc]]);
  it('a task goes to the task route; a plain note, an unknown id and a bare #/notes go nowhere', () => {
    expect(notesRouteRedirect([ids[0] as string], docs)).toEqual(['tasks', ids[0]]);
    expect(notesRouteRedirect([ids[1] as string], docs)).toBeUndefined();
    expect(notesRouteRedirect(['nope'], docs)).toBeUndefined();
    expect(notesRouteRedirect([], docs)).toBeUndefined();
  });
  it('the registry applies it only when the target itself is shown', () => {
    registerHiddenRedirect('notes', notesRouteRedirect);
    const component = () => null;
    registerView({ id: 'notes', title: 'Notes', path: 'notes', order: 50, component });
    registerView({ id: 'tasks', title: 'Tasks', path: 'tasks', order: 60, component });
    expect(hiddenRedirect(['notes', ids[0] as string], docs, effectiveHidden(['notes']))).toEqual(['tasks', ids[0]]);
    expect(hiddenRedirect(['notes', ids[0] as string], docs, effectiveHidden(['notes', 'tasks']))).toBeUndefined();
    expect(hiddenRedirect(['notes', ids[1] as string], docs, effectiveHidden(['notes']))).toBeUndefined();
  });
});
