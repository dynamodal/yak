import './help.css';
import './previous-page';
import { registerCommand } from '../app/commands';
import { registerBanner, registerHeaderItem, registerTabBadge, registerView } from '../app/registry';
import { AlphaNotice } from './AlphaNotice';
import { HelpButton, useHasNewChanges } from './HelpButton';
import { lazyView } from '../app/lazy';

// Help is a page of its own at `#/help[/<section>]`, opened from Settings › Help, the palette ("Go to Help") and the welcome screen; it is not a tab or a Settings page.
// (`#/settings/help/<x>` redirects here: see App.tsx.)
registerView({ id: 'help', title: 'Help & About', commandTitle: 'Help', path: 'help', order: 99, hidden: true, component: lazyView(() => import('./HelpView').then((m) => ({ default: m.HelpView }))) });
registerHeaderItem({ id: 'help', order: 95, where: 'welcome', component: HelpButton });
// What's new: a neutral dot on the Settings tab until this device has looked (it used to sit on the header's "?").
registerTabBadge({ id: 'whats-new', tab: 'settings', label: 'something is new', useActive: useHasNewChanges });
registerCommand({ id: 'help.report', title: 'Report a problem', run: () => void (location.hash = '#/help/report') });
registerBanner(AlphaNotice);
