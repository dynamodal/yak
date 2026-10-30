import './history.css';
import { registerBanner, registerGlobal } from '../app/registry';
import { lazyComponent } from '../app/lazy';
import { registerSettingsPart } from '../app/settings-parts';
import { HistoryBanner } from './HistoryBanner';
import { HistoryHost } from './HistoryHost';
import './test-hook';

registerGlobal({ id: 'history', component: HistoryHost });
registerBanner(HistoryBanner);
registerSettingsPart({ id: 'version-history', section: 'version-history', order: 10, component: lazyComponent(() => import('./HistoryPart').then((m) => ({ default: m.HistoryPart }))) });
