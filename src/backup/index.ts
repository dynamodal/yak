import './backup.css';
import { registerBanner, registerView } from '../app/registry';
import { registerDataLine } from '../app/data-lines';
import { registerNeed } from '../app/needs';
import { useBackupNeed } from './need';
import { BackupLine } from './BackupLine';
import { BackupBanner } from './BackupBanner';
import { lazyView } from '../app/lazy';

registerView({ id: 'backup', title: 'Backup & restore', commandTitle: 'Backup & restore', path: 'backup', order: 80, group: 'settings', component: lazyView(() => import('./BackupsView').then((m) => ({ default: m.BackupsView }))) });
registerBanner(BackupBanner);
registerDataLine({ id: 'backup', order: 10, component: BackupLine });
registerNeed({ id: 'backup', order: 50, useNeed: useBackupNeed });
