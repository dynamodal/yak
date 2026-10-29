import { registerSearchSource, type SearchEntry, setSearchTarget } from '../app/search-sources';
import { liveClients, liveProjects } from './catalog';
import { isRunning, liveEntries } from './entries';
import { isoToMs } from './dates';

/** Time entries, projects and clients for the universal search. */
registerSearchSource({
  id: 'time',
  collect(app, spaceId) {
    const doc = app.spaceDocs.get(spaceId);
    const priv = app.privateDocs.get(spaceId);
    if (!doc || !priv) return [];
    const projects = liveProjects(doc, priv);
    const clients = liveClients(doc);
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const goProjects = (kind: string, id: string): void => {
      setSearchTarget({ kind, spaceId, id });
      location.hash = '#/settings/organize';
    };
    const out: SearchEntry[] = [
      ...projects.map((p) => ({
        kind: 'project',
        spaceId,
        id: p.id,
        title: p.name,
        names: [clientById.get(p.client_id ?? '')?.name ?? ''].filter(Boolean),
        open: () => goProjects('project', p.id),
      })),
      ...clients.map((c) => ({ kind: 'client', spaceId, id: c.id, title: c.name, open: () => goProjects('client', c.id) })),
    ];
    for (const e of liveEntries(priv)) {
      const project = projectById.get(e.project_id ?? '');
      const day = new Date(isoToMs(e.start)).toLocaleDateString();
      out.push({
        kind: 'entry',
        spaceId,
        id: e.id,
        title: e.description || `${project ? project.name : 'Entry'}${isRunning(e) ? ' (running)' : ''}`,
        names: [project?.name ?? '', clientById.get(project?.client_id ?? '')?.name ?? '', day].filter(Boolean),
        text: e.description,
        tags: e.tags ?? [],
        open: () => {
          setSearchTarget({ kind: 'entry', spaceId, id: e.id, at: isoToMs(e.start) });
          location.hash = '#/time/week';
        },
      });
    }
    return out;
  },
});
