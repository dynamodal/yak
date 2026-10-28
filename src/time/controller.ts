import type { BusEvents, EventBus } from '../core/bus';
import {
  type EntryFields,
  entryFields,
  type RunningRef,
  type TimeDocs,
  startTimer,
  stopEntryAt,
} from './entries';
import { enforceSingleRunning } from './rule';

/**
 * Timer actions that also tell the rest of the app about it: `timer:started` and `timer:stopped`
 * on the bus (backups listen for stops). Plain edits go through the model functions directly.
 */
export class TimeController {
  /**
   * `privateDocs` hold the entries; `catalogDocs` (the spaces' main documents) the projects. Tests that
   * keep both in one document pass only `privateDocs`.
   */
  constructor(
    readonly privateDocs: TimeDocs,
    private readonly bus: EventBus,
    readonly deviceId: string,
    readonly catalogDocs: TimeDocs = privateDocs,
  ) {}

  private announceStopped(stopped: readonly Pick<RunningRef, 'spaceId' | 'id'>[]): void {
    for (const s of stopped) this.bus.emit('timer:stopped', { spaceId: s.spaceId, entryId: s.id });
  }

  /** Start a timer. Whatever was running, in any space, is stopped first. */
  start(spaceId: string, fields: Partial<EntryFields> = {}, now: number = Date.now()): string {
    const result = startTimer(this.privateDocs, spaceId, this.deviceId, fields, now, this.catalogDocs);
    this.announceStopped(result.stopped);
    this.bus.emit('timer:started', { spaceId, entryId: result.id });
    return result.id;
  }

  stop(ref: Pick<RunningRef, 'spaceId' | 'id'>, now: number = Date.now()): void {
    const doc = this.privateDocs.get(ref.spaceId);
    if (doc && stopEntryAt(doc, ref.id, now)) this.announceStopped([ref]);
  }

  /** Start a new entry with the fields of a past one. */
  continueFrom(spaceId: string, source: Partial<EntryFields>, now: number = Date.now()): string {
    const result = startTimer(this.privateDocs, spaceId, this.deviceId, entryFields(source), now, this.catalogDocs);
    this.announceStopped(result.stopped);
    this.bus.emit('timer:started', { spaceId, entryId: result.id });
    return result.id;
  }

  /** Idle time: stop the running entry when the user left; optionally start the same work again now. */
  discardIdle(ref: RunningRef, sinceMs: number, thenContinue: boolean, now: number = Date.now()): void {
    const doc = this.privateDocs.get(ref.spaceId);
    if (!doc) return;
    stopEntryAt(doc, ref.id, sinceMs);
    this.announceStopped([ref]);
    if (thenContinue) this.start(ref.spaceId, entryFields(ref.entry), now);
  }

  /** Apply the running-timer rule; call whenever any `time_entries` changes. */
  enforce(): RunningRef[] {
    const stopped = enforceSingleRunning(this.privateDocs);
    this.announceStopped(stopped);
    return stopped;
  }

  /** The tasks view asks for a timer through the bus. */
  handleStartRequest(req: BusEvents['timer:start-request']): void {
    if (!this.privateDocs.has(req.spaceId)) return;
    this.start(req.spaceId, {
      description: req.description,
      task_id: req.taskId ?? null,
      project_id: req.projectId ?? null,
      tags: req.tags ?? [],
    });
  }
}
