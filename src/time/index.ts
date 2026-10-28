import './search-source';
import './tag-source';
import './time.css';
import { registerCommand } from '../app/commands';
import { useEffect } from 'preact/hooks';
import { registerGlobal, registerHeaderItem, registerView } from '../app/registry';
import { IconClock } from '../app/ui';
import { TimeController } from './controller';
import { compareRunning, findRunning } from './entries';
import { HeaderTimer } from './HeaderTimer';
import { ProjectsView } from './ProjectsView';
import { TimeBackground } from './TimeBackground';
import { TimerCue } from './TimerCue';
import { TimerView } from './TimerView';

registerView({
  id: 'timer',
  title: 'Time',
  path: 'time',
  icon: IconClock,
  order: 10,
  // The List | Week switch; views that join the page (Reports) add their own segments after these.
  modes: [
    { id: 'list', label: 'List' },
    { id: 'week', label: 'Week' },
  ],
  component: TimerView,
});
// The old Entries page is the Week view of the Time page; `#/entries` still lands there.
function EntriesRedirect() {
  useEffect(() => location.replace('#/time/week'), []);
  return null;
}
registerView({ id: 'entries', title: 'Entries', path: 'entries', order: 20, hidden: true, component: EntriesRedirect });
registerCommand({ id: 'go.entries', title: 'Go to Entries', run: () => void (location.hash = '#/time/week') });
// Organize (projects, clients, tags, task values) is owned by no tab: pickers, the palette and Settings link to it.
registerView({ id: 'organize', title: 'Organize', path: 'organize', order: 92, hidden: true, component: ProjectsView });
registerCommand({ id: 'go.organize', title: 'Go to Organize', run: () => void (location.hash = '#/organize') });
registerGlobal({ id: 'time', component: TimeBackground });
registerGlobal({ id: 'time-cue', component: TimerCue });
registerHeaderItem({ id: 'timer', order: 10, component: HeaderTimer });

// Stop the running timer, or start one in the space new items go to.
registerCommand({
  id: 'timer.toggle',
  title: 'Start or stop the timer',
  shortcuts: ['Alt+S'],
  run: ({ app }) => {
    const controller = new TimeController(app.privateDocs, app.bus, app.deviceId, app.spaceDocs);
    const running = findRunning(app.privateDocs).sort(compareRunning);
    const current = running[running.length - 1];
    if (current) controller.stop(current);
    else controller.start(app.spaceId);
  },
});
