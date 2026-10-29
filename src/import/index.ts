import { registerView } from '../app/registry';
import { registerDataLine } from '../app/data-lines';
import { ImportLine } from './ImportLine';
import { lazyView } from '../app/lazy';

registerView({ id: 'import', title: 'Import', path: 'import', order: 85, group: 'settings', component: lazyView(() => import('./ImportView').then((m) => ({ default: m.ImportView }))) });
registerDataLine({ id: 'import', order: 90, component: ImportLine });
