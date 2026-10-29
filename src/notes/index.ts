import './search-source';
import './tag-source';
import { registerCommand } from '../app/commands';
import { lazyComponent } from '../app/lazy';
import { registerHomeCard } from '../app/home-cards';
import { registerGlobal, registerHiddenRedirect, registerView } from '../app/registry';
import { IconCheckbox, IconNote } from '../app/ui';
import { registerSection } from '../app/sections';
import { notesRouteRedirect } from './task-route';
import { TaskValues } from './TaskRulesCard';
import { navigate, parseHash } from '../app/router';
import { bus } from '../core/bus';
import { formatDate, readDaily } from '../core/templates';
import './notes.css';
import { openTodaysNote } from './daily';
import { NoticeWatch } from './NoticeWatch';
import { INSERT_EVENT } from './views/NoteEditor';
import { NotesView } from './views/NotesView';
import { requestSwitcher } from './views/QuickSwitcher';
import { TasksView } from './views/TasksView';

registerView({ id: 'notes', title: 'Notes', path: 'notes', order: 50, icon: IconNote, component: NotesView });
registerGlobal({ id: 'notes-notices', component: NoticeWatch });
registerSection({ id: 'task-values', page: 'organize', title: 'Task values', order: 30, feature: 'tasks', component: TaskValues });
registerView({ id: 'tasks', title: 'Tasks', path: 'tasks', order: 60, icon: IconCheckbox, component: TasksView });

// With Notes off, an old `#/notes/<task>` opens the task under Tasks (F-33n).
registerHiddenRedirect('notes', notesRouteRedirect);

// Other modules open a note through the bus; the notes view switches space if the note lives in another one.
bus.on('notes:open', ({ noteId }) => navigate('notes', noteId));

// Commands. Ctrl/Cmd+O (as in Obsidian) or Ctrl/Cmd+P (as in VS Code and Notion) anywhere: the quick
// switcher, opening the notes view first. Ctrl+K stays free for "insert link" in the editor.
registerCommand({
  id: 'notes.find',
  title: 'Find a note',
  shortcuts: ['Ctrl+O', 'Ctrl+P'],
  run: () => {
    if (parseHash(location.hash)[0] !== 'notes') navigate('notes');
    requestSwitcher();
  },
});
registerCommand({ id: 'notes.today', title: "Open today's note", run: ({ app }) => void openTodaysNote(app) });
registerCommand({
  id: 'notes.insert-date',
  title: "Insert today's date",
  shortcuts: ['Ctrl+Shift+D'],
  run: ({ app }) => {
    // Into the note being edited; nowhere else has a cursor to put it.
    const active = document.activeElement;
    const editor = active?.closest('.note-editor') ?? active?.querySelector('.note-editor');
    editor?.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: formatDate(new Date(), readDaily(app.account).format) }));
  },
});

// Home's cards for tasks and notes load with the Home page (F-33p).
registerHomeCard({ id: 'due', order: 30, feature: 'tasks', component: lazyComponent(() => import('./HomeCards').then((m) => ({ default: m.DueSoonCard }))) });
registerHomeCard({ id: 'notes', order: 40, feature: 'notes', component: lazyComponent(() => import('./HomeCards').then((m) => ({ default: m.RecentNotesCard }))) });
