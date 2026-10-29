import './mirror.css';
import { registerBanner } from '../app/registry';
import { registerSection } from '../app/sections';
import { MirrorBanner } from './MirrorBanner';
import { lazyView } from '../app/lazy';

// Mirror is a row of Settings › Notes (the ⚙ on Notes opens it). It always shows: where the browser cannot
// pick a folder it says so (and when no window exists, as in unit tests, the section is never rendered).
registerSection({ id: 'mirror', page: 'note-settings', title: 'Mirror to a folder', order: 50, feature: 'mirror', component: lazyView(() => import('./MirrorView').then((m) => ({ default: m.MirrorView }))) });
registerBanner(MirrorBanner);
