import './settings.css';
import { registerHomeCard } from '../app/home-cards';
import { registerView } from '../app/registry';
import { lazyView } from '../app/lazy';
import { NeedsCard } from './NeedsCard';
import { applyTheme, readTheme } from './theme';

if (typeof document !== 'undefined') applyTheme(readTheme());

// Settings is one long page (F-33); its path is the group's own name, so `#/settings` opens it, and `#/settings/<section>[/<row>]` scrolls to a
// section and opens a row. Only Add a device (src/devices), and Import have views of their own.
registerView({ id: 'settings', title: 'Settings', path: 'settings', order: 95, group: 'settings', component: lazyView(() => import('./SettingsView').then((m) => ({ default: m.SettingsView }))) });

registerHomeCard({ id: 'needs', order: 10, wide: true, component: NeedsCard });
