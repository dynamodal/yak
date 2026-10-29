import { useEffect } from 'preact/hooks';
import { APP_NAME } from '../constants';
import { effectiveHidden, setFeatureBlock, useHiddenModules } from '../app/features';
import { applyBadge, type BadgeNavigator, cueTitle } from './cue';
import { startMs } from './entries';
import { useRunning } from './hooks';
import runningIcon from './icons/timer-running.svg?url';
import stoppedIcon from './icons/timer-stopped.svg?url';

const ICON_ID = 'app-timer-icon';

function setFavicon(href: string): void {
  let link = document.getElementById(ICON_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = ICON_ID;
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    document.head.append(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

const APP_ICON = '/icon.svg';
const RUNNING_BLOCK = 'A timer is running. Stop it before hiding Time.';

/**
 * Always mounted (a global): shows whether a timer runs outside the page, for a minimised window
 * or a background tab. The title starts with the elapsed time, the favicon switches, and an
 * installed app gets a badge. Renders nothing. With Time hidden (F-33l) the cue is off: the plain
 * app title and icon and no badge. While a timer runs, Time cannot be hidden (Settings shows why).
 */
export function TimerCue() {
  const running = useRunning();
  const off = effectiveHidden(useHiddenModules()).has('time');
  const current = running[running.length - 1];
  const since = current && !off ? startMs(current.entry) : null;
  const description = current?.entry.description ?? '';
  const isRunning = since !== null;

  useEffect(() => {
    setFeatureBlock('time', current ? RUNNING_BLOCK : null);
  }, [!!current]);
  useEffect(() => () => setFeatureBlock('time', null), []);

  useEffect(() => {
    setFavicon(off ? APP_ICON : isRunning ? runningIcon : stoppedIcon);
    void applyBadge(navigator as BadgeNavigator, isRunning);
  }, [isRunning, off]);

  useEffect(() => {
    if (off) document.title = APP_NAME;
  }, [off]);

  useEffect(() => {
    if (off) return undefined;
    const update = (): void => {
      const precision = document.visibilityState === 'hidden' ? 'minutes' : 'seconds';
      document.title = cueTitle(since === null ? null : { elapsedSeconds: (Date.now() - since) / 1000, description }, APP_NAME, precision);
    };
    update();
    if (since === null) return undefined;
    const tick = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', update);
    };
  }, [since, description, off]);

  return null;
}
