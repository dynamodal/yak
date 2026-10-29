import { registerView } from '../app/registry';
import { registerSettingsPart } from '../app/settings-parts';
import './devices.css';
import { lazyView } from '../app/lazy';
import { ConnectionPart, DeviceNotices, IdsAndKeys, ResetPart } from './parts';

// Add a device is the one devices page that stays (F-33); the devices themselves are rows on the Settings page.
registerView({ id: 'devices', title: 'Add a device', commandTitle: 'Devices', path: 'devices', order: 90, group: 'settings', component: lazyView(() => import('./AddDeviceView').then((m) => ({ default: m.AddDeviceView }))) });
registerView({ id: 'network', title: 'Network stats', path: 'network', order: 91, group: 'settings', hidden: true, component: lazyView(() => import('./NetworkStatsView').then((m) => ({ default: m.NetworkStatsView }))) });
// What Settings shows from this module: notices under the Sync line, and the internals in Advanced.
registerSettingsPart({ id: 'device-notices', section: 'devices-sync', order: 10, component: DeviceNotices });
registerSettingsPart({ id: 'device-keys', section: 'advanced', order: 10, component: IdsAndKeys });
registerSettingsPart({ id: 'connection', section: 'advanced', order: 20, component: ConnectionPart });
registerSettingsPart({ id: 'reset-device', section: 'advanced', order: 30, component: ResetPart });
