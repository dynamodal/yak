import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { useSettings } from '../app/hooks';
import { useSpaceFilter } from '../app/space-filter';
import { ratesMap } from '../core/rates';
import { collection } from '../core/schema';
import {
  type ClientRecord,
  liveClients,
  liveProjects,
  type ProjectRecord,
  pickerTagNames,
} from './catalog';
import { TimeController } from './controller';
import { type LastEntry, lastStopped } from './cue';
import type { WeekStart } from './dates';
import { compareRunning, type EntryRecord, findRunning, isRunning, liveEntries, type RunningRef, startMs } from './entries';
import { repeatKey } from './grouping';
import { buildCandidates, type Candidate } from './fuzzy';
import { buildRecents, type Recents } from './recents';
import type { HoursFormat } from './format';

export function useController(): TimeController {
  const { spaceDocs, privateDocs, bus, deviceId } = useApp();
  return useMemo(() => new TimeController(privateDocs, bus, deviceId, spaceDocs), [privateDocs, spaceDocs, bus, deviceId]);
}

/** Bumps whenever any space's `time_entries` changes. */
function useAllEntriesVersion(): number {
  const { privateDocs } = useApp();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1);
    const maps = [...privateDocs.values()].map((d) => collection(d, 'time_entries'));
    for (const m of maps) m.observeDeep(bump);
    return () => {
      for (const m of maps) m.unobserveDeep(bump);
    };
  }, [privateDocs]);
  return version;
}

/** Running entries across every space, oldest start first (the one that counts is last). */
export function useRunning(): RunningRef[] {
  const { privateDocs } = useApp();
  const version = useAllEntriesVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => findRunning(privateDocs).sort(compareRunning), [privateDocs, version]);
}

/** The entry that stopped last, in any space (for "continue last entry"). */
export function useLastStopped(): LastEntry | undefined {
  const { privateDocs } = useApp();
  const version = useAllEntriesVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => lastStopped(privateDocs), [privateDocs, version]);
}

/** The entries finished most recently, each distinct piece of work once, across every space. */
export function useRecentEntries(limit: number): EntryRecord[] {
  const { privateDocs } = useApp();
  const version = useAllEntriesVersion();
  return useMemo(() => {
    const all = [...privateDocs].flatMap(([spaceId, doc]) => liveEntries(doc).filter((e) => !isRunning(e)).map((e) => ({ ...e, spaceId })));
    all.sort((a, b) => startMs(b) - startMs(a));
    const seen = new Set<string>();
    const out: EntryRecord[] = [];
    for (const e of all) {
      const key = repeatKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
      if (out.length === limit) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateDocs, version, limit]);
}

/** Past work to suggest while typing a description, across every space; built on first use and again after entries change. */
export function useCandidates(): () => Candidate[] {
  const { privateDocs, spaceDocs } = useApp();
  const version = useAllEntriesVersion();
  const cache = useRef<{ key: unknown; list: Candidate[] }>({ key: null, list: [] });
  return () => {
    const key = [privateDocs, spaceDocs, version];
    const c = cache.current;
    if (!Array.isArray(c.key) || c.key[0] !== privateDocs || c.key[1] !== spaceDocs || c.key[2] !== version) {
      const names = (sid: string, pid: string): string => {
        const doc = spaceDocs.get(sid);
        return (doc && (collection(doc, 'projects').get(pid)?.get('name') as string | undefined)) || '';
      };
      cache.current = { key, list: buildCandidates(privateDocs, names) };
    }
    return cache.current.list;
  };
}

/** The pill popover's recent list: the entry that stopped last, then distinct recent work, across every space (never the running one). */
export function useRecents(running: RunningRef | undefined): Recents {
  const { privateDocs } = useApp();
  const version = useAllEntriesVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildRecents(privateDocs, { running }), [privateDocs, version, running?.id, running?.entry.description, running?.entry.project_id, running?.entry.tags.join('\u0000')]);
}

export interface TimeData {
  /** The active space's main document: projects, clients, tags. */
  doc: Y.Doc;
  /** The active space's time document: entries. */
  privateDoc: Y.Doc;
  spaceId: string;
  controller: TimeController;
  deviceId: string;
  entries: EntryRecord[];
  projects: ProjectRecord[];
  clients: ClientRecord[];
  projectById: ReadonlyMap<string, ProjectRecord>;
  clientById: ReadonlyMap<string, ClientRecord>;
  tagNames: string[];
  hoursFormat: HoursFormat;
  weekStart: WeekStart;
}

/** The time data of one space; `entries` carry their space. */
function sliceOf(spaceId: string, doc: Y.Doc, privateDoc: Y.Doc, controller: TimeController, deviceId: string, hoursFormat: HoursFormat, weekStart: WeekStart): TimeData {
  const projects = liveProjects(doc, privateDoc);
  const clients = liveClients(doc);
  return {
    doc,
    privateDoc,
    spaceId,
    controller,
    deviceId,
    entries: liveEntries(privateDoc).map((e) => ({ ...e, spaceId })),
    projects,
    clients,
    projectById: new Map(projects.map((p) => [p.id, p])),
    clientById: new Map(clients.map((c) => [c.id, c])),
    tagNames: pickerTagNames(doc),
    hoursFormat,
    weekStart,
  };
}

/** What the Timer and Entries pages read: every space this device keeps, narrowed by the space filter. */
export interface AllTime {
  /** The data of each space, so a row edits the space its entry lives in. */
  slices: ReadonlyMap<string, TimeData>;
  /** The data of the space new items go to (the last used one). */
  data: TimeData;
  /** Entries of the spaces shown, each tagged with its space. */
  entries: EntryRecord[];
  /** More than one space is kept here, so rows carry a space label and a filter is offered. */
  multi: boolean;
  filter: string;
  setFilter(id: string): void;
}

/** Entries, projects and tags of every kept space, re-read when any of them changes. */
export function useAllTime(): AllTime {
  const { spaceDocs, privateDocs, spaceId } = useApp();
  const controller = useController();
  const { deviceId } = useApp();
  const { settings } = useSettings();
  const [filter, setFilter] = useSpaceFilter();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1);
    const maps = [
      ...[...spaceDocs.values()].flatMap((d) => [collection(d, 'projects'), collection(d, 'clients'), collection(d, 'tags'), d.getMap('hidden_tags')]),
      ...[...privateDocs.values()].flatMap((d) => [collection(d, 'time_entries'), ratesMap(d)]),
    ];
    for (const m of maps) m.observeDeep(bump);
    return () => {
      for (const m of maps) m.unobserveDeep(bump);
    };
  }, [spaceDocs, privateDocs]);
  return useMemo(() => {
    const slices = new Map<string, TimeData>();
    for (const [id, doc] of spaceDocs) {
      const priv = privateDocs.get(id);
      if (priv) slices.set(id, sliceOf(id, doc, priv, controller, deviceId, settings.hours_format, settings.week_start));
    }
    const data = slices.get(spaceId) ?? [...slices.values()][0];
    const shown = filter === 'all' || !slices.has(filter) ? [...slices.values()] : [slices.get(filter) as TimeData];
    return {
      slices,
      data: data as TimeData,
      entries: shown.flatMap((s) => s.entries),
      multi: slices.size > 1,
      filter: slices.has(filter) ? filter : 'all',
      setFilter,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceDocs, privateDocs, spaceId, filter, version, controller, deviceId, settings.hours_format, settings.week_start]);
}

/** Display names of the account's spaces; the one place the time module looks them up. */
export function useSpaceName(): (spaceId: string) => string {
  const { spaces } = useApp();
  return useMemo(() => (spaceId: string) => spaces.find((s) => s.id === spaceId)?.name ?? 'another space', [spaces]);
}

/** Projects, clients and tags of one space, for pickers that offer every space this device keeps. */
export interface SpaceCatalog {
  spaceId: string;
  name: string;
  /** The space's main document. */
  doc: Y.Doc;
  projects: ProjectRecord[];
  clients: ClientRecord[];
  projectById: ReadonlyMap<string, ProjectRecord>;
  clientById: ReadonlyMap<string, ClientRecord>;
  tagNames: string[];
}

/** The catalog of every space this device keeps, the active space first; re-read when any changes. */
export function useCatalogs(): SpaceCatalog[] {
  const { spaceDocs, privateDocs, spaceId } = useApp();
  const name = useSpaceName();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1);
    const maps = [
      ...[...spaceDocs.values()].flatMap((d) => [collection(d, 'projects'), collection(d, 'clients'), collection(d, 'tags'), d.getMap('hidden_tags')]),
      // Rates live in each space's private part.
      ...[...privateDocs.values()].map((d) => ratesMap(d)),
    ];
    for (const m of maps) m.observeDeep(bump);
    return () => {
      for (const m of maps) m.unobserveDeep(bump);
    };
  }, [spaceDocs, privateDocs]);
  return useMemo(() => {
    const out = [...spaceDocs].map(([id, doc]): SpaceCatalog => {
      const projects = liveProjects(doc, privateDocs.get(id));
      const clients = liveClients(doc);
      return {
        spaceId: id,
        name: name(id),
        doc,
        projects,
        clients,
        projectById: new Map(projects.map((p) => [p.id, p])),
        clientById: new Map(clients.map((c) => [c.id, c])),
        tagNames: pickerTagNames(doc),
      };
    });
    return out.sort((a, b) => (a.spaceId === spaceId ? -1 : b.spaceId === spaceId ? 1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceDocs, privateDocs, spaceId, version, name]);
}
