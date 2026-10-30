import './backup.css';
import { registerBanner, registerView } from '../app/registry';
import { registerSettingsPart } from '../app/settings-parts';
import { registerNeed } from '../app/needs';
import { useBackupNeed } from './need';
import { BackupBanner } from './BackupBanner';
import { lazyComponent, lazyView } from '../app/lazy';

// The welcome screen opens this to restore before a device is set up; once set up, `#/backup` redirects to the Backups section of Settings (#97).
registerView({ id: 'backup', title: 'Restore from a backup', path: 'backup', order: 80, hidden: true, component: lazyView(() => import('./BackupsView').then((m) => ({ default: m.BackupsView }))) });
registerBanner(BackupBanner);
registerNeed({ id: 'backup', order: 50, useNeed: useBackupNeed });
registerSettingsPart({ id: 'backups', section: 'backups', order: 10, component: lazyComponent(() => import('./BackupsView').then((m) => ({ default: m.BackupsPart }))) });
registerSettingsPart({ id: 'passphrase-manage', section: 'passphrase', order: 10, component: lazyComponent(() => import('./PassphraseSection').then((m) => ({ default: m.PassphraseSection }))) });
