import './help.css';
import './previous-page';
import { registerCommand } from '../app/commands';
import { registerBanner, registerHeaderItem, registerView } from '../app/registry';
import { AlphaNotice } from './AlphaNotice';
import { HelpButton, WhatsNewChip } from './HelpButton';
import { lazyView } from '../app/lazy';

// Help is a page of its own at `#/help[/<section>]`, opened from Settings › Help, the palette ("Go to Help") and the welcome screen; it is not a tab or a Settings page.
// (`#/settings/help/<x>` redirects here: see App.tsx.)
registerView({ id: 'help', title: 'Help & About', commandTitle: 'Help', path: 'help', order: 99, hidden: true, component: lazyView(() => import('./HelpView').then((m) => ({ default: m.HelpView }))) });
registerHeaderItem({ id: 'help', order: 95, where: 'welcome', component: HelpButton });
// What's new: a "New" chip in the header until this device has opened it (#74); the Settings tab badge is only for what needs the person.
registerHeaderItem({ id: 'whats-new', order: 5, component: WhatsNewChip });
registerCommand({ id: 'help.report', title: 'Report a problem', run: () => void (location.hash = '#/help/report') });
registerBanner(AlphaNotice);
