import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { Button } from '../app/ui';
import { addNotice } from '../core/notices';
import { collection } from '../core/schema';
import { compareRunning, findRunning, type RunningRef, startMs } from './entries';
import { formatSpan, formatTimeOfDay } from './format';
import { useController, useRunning } from './hooks';
import { IdleTracker } from './idle';

interface Idle {
  since: number;
  ms: number;
}

/**
 * Always mounted (registered as a global): applies the running-timer rule whenever time entries
 * change, answers `timer:start-request` from the bus, and shows the idle-time banner.
 */
export function TimeBackground() {
  const { privateDocs, bus } = useApp();
  const controller = useController();
  const running = useRunning();
  const [idle, setIdle] = useState<Idle | null>(null);

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        for (const r of controller.enforce()) {
          const what = r.entry.description ? `“${r.entry.description}”` : 'a timer';
          addNotice({
            key: `timer-stopped:${r.id}`,
            kind: 'timer-stopped',
            text: `Another device was also timing, so ${what} was stopped when the later timer started at ${formatTimeOfDay(startMs(r.entry))}. Only one timer runs at a time.`,
            spaceId: r.spaceId,
          });
        }
      }, 0);
    };
    const maps = [...privateDocs.values()].map((d) => collection(d, 'time_entries'));
    for (const m of maps) m.observeDeep(schedule);
    schedule();
    return () => {
      clearTimeout(pending);
      for (const m of maps) m.unobserveDeep(schedule);
    };
  }, [privateDocs, controller]);

  useEffect(() => bus.on('timer:start-request', (req) => controller.handleStartRequest(req)), [bus, controller]);

  useEffect(() => {
    const tracker = new IdleTracker(Date.now());
    const check = (gap: Idle | null): void => {
      if (!gap) return;
      const current = findRunning(privateDocs).sort(compareRunning).at(-1);
      if (current && startMs(current.entry) < gap.since) setIdle((prev) => prev ?? gap);
    };
    // Ticks run while hidden too, so a hidden tab is not "away"; only a gap with no ticks (sleep, a frozen page) is.
    const tick = setInterval(() => check(tracker.tick(Date.now())), 1000);
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') check(tracker.tick(Date.now()));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [privateDocs]);

  const current: RunningRef | undefined = running[running.length - 1];
  // The banner only makes sense for a timer that is still running and started before the gap.
  const active = idle && current && startMs(current.entry) < idle.since ? current : undefined;
  useEffect(() => {
    if (idle && !active) setIdle(null);
  }, [idle, active]);
  if (!idle || !active) return null;

  const decide = (discard: boolean, thenContinue: boolean): void => {
    if (discard) controller.discardIdle(active, idle.since, thenContinue);
    setIdle(null);
  };
  return (
    <div class="idle-banner" role="alertdialog" aria-label="Idle time" aria-describedby="idle-text">
      <p id="idle-text">
        You were away for {formatSpan(idle.ms)} (since {formatTimeOfDay(idle.since)}). The timer
        {active.entry.description ? ` “${active.entry.description}”` : ''} kept running.
      </p>
      <div class="row">
        <Button onClick={() => decide(false, false)}>
          Keep time
        </Button>
        <Button variant="primary" onClick={() => decide(true, false)}>
          Discard idle time
        </Button>
        <Button onClick={() => decide(true, true)}>
          Discard and continue
        </Button>
      </div>
    </div>
  );
}
