import { registerHomeCard } from '../app/home-cards';
import { registerView } from '../app/registry';
import { lazyComponent, lazyView } from '../app/lazy';

registerView({ id: 'reports', title: 'Reports', path: 'reports', order: 30, joins: 'timer', component: lazyView(() => import('./ReportsView').then((m) => ({ default: m.ReportsView }))) });

// Home's two time cards load with the Home page, not with the app (F-210).
registerHomeCard({ id: 'week', order: 20, feature: 'time', component: lazyComponent(() => import('./HomeCards').then((m) => ({ default: m.WeekCard }))) });
registerHomeCard({ id: 'projects', order: 50, feature: 'time', component: lazyComponent(() => import('./HomeCards').then((m) => ({ default: m.ProjectsCard }))) });
