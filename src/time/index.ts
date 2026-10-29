import './search-source';
import './tag-source';
import './time.css';
import { registerCommand } from '../app/commands';
import { lazyComponent } from '../app/lazy';
import { useEffect } from 'preact/hooks';
import { registerGlobal, registerHeaderItem, registerView } from '../app/registry';
import { registerSettingsPart } from '../app/settings-parts';
import { IconClock } from '../app/ui';
import { TimeController } from './controller';
import { compareRunning, findRunning } from './entries';
import { HeaderTimer } from './HeaderTimer';
import { TimeBackground } from './TimeBackground';
import { requestTimerPopover } from './pill-events';
import { TimerCue } from './TimerCue';
import { startFromDraft } from './timer-start';
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
// Organize (projects, clients, tags, task values) is a section of Settings (F-33x): this module adds its body; pickers and the palette link to it.
registerSettingsPart({ id: 'organize', section: 'organize', order: 10, component: lazyComponent(() => import('./ProjectsView').then((m) => ({ default: m.OrganizeBody }))) });
registerCommand({ id: 'go.organize', title: 'Go to Organize', run: () => void (location.hash = '#/settings/organize') });
registerGlobal({ id: 'time', component: TimeBackground });
registerGlobal({ id: 'time-cue', component: TimerCue });
registerHeaderItem({ id: 'timer', order: 10, component: HeaderTimer });

// Alt+S (F-33k): running, it stops the timer and opens nothing. Stopped, it starts one at once (in the space new items go to,
// with whatever the popover's draft holds) and opens the pill's popover with focus in the description, so a past entry or
// project can be picked straight away; Esc closes it and leaves the timer running.
registerCommand({
  id: 'timer.toggle',
  title: 'Start or stop the timer',
  shortcuts: ['Alt+S'],
  run: ({ app }) => {
    const controller = new TimeController(app.privateDocs, app.bus, app.deviceId, app.spaceDocs);
    const running = findRunning(app.privateDocs).sort(compareRunning);
    const current = running[running.length - 1];
    if (current) {
      controller.stop(current);
      return;
    }
    const returnTo = document.activeElement;
    startFromDraft(controller, app.spaceId, app.spaceDocs, app.setSpaceId);
    requestTimerPopover(returnTo);
  },
});
