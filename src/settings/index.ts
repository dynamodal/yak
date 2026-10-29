import './settings.css';
import { registerView } from '../app/registry';
import { lazyView } from '../app/lazy';
import { NotesSettings } from './SectionViews';
import { applyTheme, readTheme } from './theme';

if (typeof document !== 'undefined') applyTheme(readTheme());

// Settings is one long page (F-33); its path is the group's own name, so `#/settings` opens it, and `#/settings/<section>[/<row>]` scrolls to a
// section and opens a row. Only Add a device (src/devices), Backup & restore (src/backup) and Import have views of their own.
registerView({ id: 'settings', title: 'Settings', path: 'settings', order: 95, group: 'settings', component: lazyView(() => import('./SettingsView').then((m) => ({ default: m.SettingsView }))) });
// Note settings (links, files, daily notes, Mirror) belong to Notes: a ⚙ there opens this page, which is no Settings page.
registerView({ id: 'notes-settings', title: 'Note settings', path: 'note-settings', order: 97, hidden: true, component: NotesSettings });
