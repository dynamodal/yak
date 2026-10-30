import './mirror.css';
import { registerBanner } from '../app/registry';
import { registerSettingsPart } from '../app/settings-parts';
import { MirrorBanner } from './MirrorBanner';
import { lazyComponent } from '../app/lazy';

// Mirror to a folder is a section of Settings of its own (#95): it covers notes and tasks. It always shows while the feature is on: where the browser
// cannot pick a folder it says so (and when no window exists, as in unit tests, the section is never rendered).
registerSettingsPart({ id: 'mirror', section: 'mirror', order: 10, component: lazyComponent(() => import('./MirrorView').then((m) => ({ default: m.MirrorView }))) });
registerBanner(MirrorBanner);
