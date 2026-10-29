import { useApp } from '../app/context';
import { type SelectionApi, useSelection } from '../app/selection';
import { useSearchTarget } from '../app/search-sources';
import { useState } from 'preact/hooks';
import { Button, IconArchive, IconEdit, IconMore, IconRestore, IconTrash, MenuButton, Pill, toast, usePageSelect } from '../app/ui';
import { Sections } from '../app/views/Sections';
import { TagManager } from '../app/views/TagManager';
import { bulkEdit } from '../core/bulk';
import type { Spaces } from './bulk-edit';
import { clientClash, moveClient, moveMany, moveProject, type MoveSelection, projectClash, projectEntryTargets } from './move-space';
import {
  type ClientRecord,
  clientProjectCount,
  createClient,
  createProject,
  deleteClient,
  deleteProject,
  moveClientProjects,
  moveProjectEntries,
  type ProjectRecord,
  projectEntryCount,
  updateClient,
  updateProject,
} from './catalog';
import { type TimeData, useAllTime, useSpaceName } from './hooks';
import { Swatch } from './widgets';
import { SpaceFilter } from '../app/space-filter';

/**
 * Delete is for something nothing uses. When something does, the choice is to move those items to
 * another one (or none) first; the count is shown before and one Undo reverses it all.
 */
function DeleteWithMove({ what, name, used, noun, options, move, remove, data, open, setOpen }: { what: string; name: string; used: number; noun: string; options: { id: string; name: string }[]; move(to: string | null): number; remove(): void; data: TimeData; open: boolean; setOpen(open: boolean): void }) {
  const [to, setTo] = useState('');
  if (!open) return null;
  const go = (): void => {
    const { result, undo } = bulkEdit([data.doc, data.privateDoc], () => {
      const moved = used > 0 ? move(to || null) : 0;
      remove();
      return moved;
    });
    toast(used > 0 ? `Moved ${result} ${noun} and deleted ${what} “${name}”.` : `Deleted ${what} “${name}”.`, { action: { label: 'Undo', run: undo } });
  };
  return (
    <span class="row delete-panel" role="group" aria-label={`Delete ${what} ${name}`}>
      {used > 0 ? (
        <>
          <span role="status">
            Used by {used} {noun}. Move them to
          </span>
          <select aria-label={`Move ${noun} of ${name} to`} value={to} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>
            <option value="">None</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <span role="status">Nothing uses it.</span>
      )}
      <Button variant="primary" onClick={go}>
        {used > 0 ? 'Move and delete' : 'Delete'}
      </Button>
      <Button onClick={() => setOpen(false)}>Cancel</Button>
    </span>
  );
}


interface MoveEnv {
  handles: Spaces;
  /** Kept spaces other than the item's own. */
  others: { id: string; name: string }[];
}

/**
 * "Move to space…": archives the item here and creates it in the chosen space (nothing is deleted).
 * A project's entries and a client's projects come along unless unticked; a name that exists there
 * is merged into or created under a new name. One bulk edit, one Undo.
 */
function MovePanel({ kind, name, data, env, open, setOpen, projectId, clientId }: { kind: 'project' | 'client'; name: string; data: TimeData; env: MoveEnv; open: boolean; setOpen(open: boolean): void; projectId?: string; clientId?: string }) {
  const [to, setTo] = useState('');
  const [entries, setEntries] = useState(true);
  const [projects, setProjects] = useState(true);
  const [clash, setClash] = useState<'merge' | 'rename'>('merge');
  const [newName, setNewName] = useState('');
  if (!open) return null;
  const dest = to || env.others[0]?.id || '';
  const nEntries = projectId ? projectEntryTargets(env.handles, data.spaceId, projectId).length : 0;
  const clientProjects = clientId ? data.projects.filter((p) => p.client_id === clientId && p.active) : [];
  const nClientEntries = clientProjects.reduce((n, p) => n + projectEntryTargets(env.handles, data.spaceId, p.id).length, 0);
  const exists = kind === 'project' ? projectClash(env.handles, dest, name) : clientClash(env.handles, dest, name);
  const destName = env.others.find((o) => o.id === dest)?.name ?? '';
  const go = (): void => {
    const { result, undo } = bulkEdit(
      [...env.handles.values()].flatMap((h) => [h.doc, h.privateDoc]),
      (tx) =>
        projectId
          ? moveProject(env.handles, data.spaceId, projectId, dest, data.deviceId, { entries, clash: exists ? (clash === 'rename' ? { kind: 'rename', name: newName.trim() } : { kind: 'merge' }) : undefined }, tx)
          : moveClient(env.handles, data.spaceId, clientId as string, dest, data.deviceId, { projects, entries }, tx),
    );
    const parts = [result.projects ? `${result.projects} ${result.projects === 1 ? 'project' : 'projects'}` : '', result.entries ? `${result.entries} ${result.entries === 1 ? 'entry' : 'entries'}` : ''].filter(Boolean);
    toast(`Moved ${kind} “${name}” to ${destName}${parts.length ? ` with ${parts.join(' and ')}` : ''}. It is archived here.`, { action: { label: 'Undo', run: undo } });
    setOpen(false);
  };
  return (
    <span class="row delete-panel" role="group" aria-label={`Move ${kind} ${name} to another space`}>
      <select aria-label={`Space to move ${name} to`} value={dest} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>
        {env.others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {kind === 'client' && (
        <label class="check">
          <input type="checkbox" checked={projects} onChange={(e) => setProjects((e.target as HTMLInputElement).checked)} />
          <span>Also move its {clientProjects.length} {clientProjects.length === 1 ? 'project' : 'projects'}</span>
        </label>
      )}
      {(kind === 'project' || projects) && (
        <label class="check">
          <input type="checkbox" checked={entries} onChange={(e) => setEntries((e.target as HTMLInputElement).checked)} />
          <span>Move its {kind === 'project' ? nEntries : nClientEntries} {(kind === 'project' ? nEntries : nClientEntries) === 1 ? 'entry' : 'entries'} too</span>
        </label>
      )}
      {exists && (
        <span class="row" role="group" aria-label="Name clash">
          <span role="status">{destName} already has “{exists.name}”.</span>
          <label class="check">
            <input type="radio" name={`clash-${kind}-${name}`} checked={clash === 'merge'} onChange={() => setClash('merge')} />
            <span>Merge into it</span>
          </label>
          {kind === 'project' && (
            <label class="check">
              <input type="radio" name={`clash-${kind}-${name}`} checked={clash === 'rename'} onChange={() => setClash('rename')} />
              <span>New name</span>
            </label>
          )}
          {kind === 'project' && clash === 'rename' && <input type="text" aria-label="New name in the other space" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />}
        </span>
      )}
      <Button variant="primary" disabled={!dest || (!!exists && clash === 'rename' && kind === 'project' && !newName.trim())} onClick={go}>
        Move
      </Button>
      <Button onClick={() => setOpen(false)}>Cancel</Button>
    </span>
  );
}

/** Selection key of a project (`p`) or client (`c`) in a space; tags use `t` (see TagManager). */
const itemKey = (kind: 'p' | 'c', spaceId: string, id: string): string => `${kind}:${spaceId}:${id}`;

function RowCheck({ sel, k, label }: { sel: SelectionApi; k: string; label: string }) {
  if (!sel.active) return null;
  return <input type="checkbox" class="row-check" aria-label={`Select ${label}`} checked={sel.has(k)} onChange={() => sel.click(k, [], { shift: false, toggle: false })} />;
}

/**
 * The bar shown while selecting: move the selected projects, clients and tags to one space. Items
 * move as they do alone (archived here, created there), names that exist there are merged into,
 * and one Undo reverses all of it.
 */
function MoveSelectedBar({ sel, handles, data, spaceIds }: { sel: SelectionApi; handles: Spaces; data: TimeData; spaceIds: { id: string; name: string }[] }) {
  const { spaceDocs } = useApp();
  const [to, setTo] = useState('');
  const [entries, setEntries] = useState(true);
  const [projects, setProjects] = useState(true);
  const dest = to || spaceIds[0]?.id || '';
  const destName = spaceIds.find((o) => o.id === dest)?.name ?? '';
  const selection = (): MoveSelection => {
    const out: MoveSelection = { projects: [], clients: [], tags: [] };
    const tags = new Map<string, string[]>();
    for (const k of sel.keys) {
      const [kind, spaceId = '', ...rest] = k.split(':');
      const id = rest.join(':');
      if (kind === 'p') out.projects.push({ spaceId, id });
      else if (kind === 'c') out.clients.push({ spaceId, id });
      else if (kind === 't') tags.set(id, [...(tags.get(id) ?? []), spaceId]);
    }
    for (const [name, ids] of tags) out.tags.push({ name, spaceIds: ids });
    return out;
  };
  const hasClients = [...sel.keys].some((k) => k.startsWith('c:'));
  const go = (): void => {
    const selected = selection();
    const all = new Map([...handles, ...[...spaceDocs].filter(([id]) => !handles.has(id)).map(([id, d]) => [id, { doc: d, privateDoc: d }] as const)]);
    const { result, undo } = bulkEdit(
      [...all.values()].flatMap((h) => [h.doc, h.privateDoc]),
      (tx) => moveMany(all, selected, dest, data.deviceId, { entries, projects }, tx),
    );
    const parts = [
      [result.projects, 'project', 'projects'],
      [result.clients, 'client', 'clients'],
      [result.tags, 'tag', 'tags'],
      [result.entries, 'entry', 'entries'],
    ].flatMap(([n, one, many]) => (n ? [`${n} ${n === 1 ? one : many}`] : []));
    const note = result.inDestination > 0 ? ` ${result.inDestination} already in ${destName}.` : '';
    toast(`Moved ${parts.join(', ') || 'nothing'} to ${destName}. They are archived or hidden where they were.${note}`, { action: { label: 'Undo', run: undo } });
    sel.clear();
  };
  return (
    <div class="bulk-bar" role="toolbar" aria-label="Move selected to another space">
      <div class="row">
        <strong class="bulk-count" role="status">
          {sel.size} selected
        </strong>
        <select aria-label="Space to move the selected items to" value={dest} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>
          {spaceIds.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {hasClients && (
          <label class="check">
            <input type="checkbox" checked={projects} onChange={(e) => setProjects((e.target as HTMLInputElement).checked)} />
            <span>Also move the projects of selected clients</span>
          </label>
        )}
        <label class="check">
          <input type="checkbox" checked={entries} onChange={(e) => setEntries((e.target as HTMLInputElement).checked)} />
          <span>Move the entries of moved projects too</span>
        </label>
        <Button variant="primary" disabled={sel.size === 0 || !dest} onClick={go}>
          Move to space
        </Button>
        <Button onClick={() => sel.clear()}>Cancel</Button>
      </div>
      <span class="muted">A name that exists there is merged into.</span>
    </div>
  );
}

const SpaceTag = ({ label }: { label?: string }) => (label ? <span class="muted space-tag">{label}</span> : null);

interface EditableRow {
  /** The edit panel is open. */
  editing: boolean;
  onEdit(open: boolean): void;
}

function ProjectRow({ project, data, space, env, sel, editing, onEdit }: { project: ProjectRecord; data: TimeData; space?: string; env: MoveEnv; sel: SelectionApi } & EditableRow) {
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const save = (patch: Parameters<typeof updateProject>[2]): void => {
    setError(updateProject(data.doc, project.id, patch, data.privateDoc) ? '' : 'That value is not valid.');
  };
  const clients = data.clients.filter((c) => !c.archived || c.id === project.client_id);
  const client = data.clients.find((c) => c.id === project.client_id);
  const rate = project.rate !== null ? `${project.rate} ${project.currency}/h` : '';
  return (
    <li class={project.active ? 'proj-row row-host' : 'proj-row row-host archived'}>
      <div class="proj-line">
        <RowCheck sel={sel} k={itemKey('p', data.spaceId, project.id)} label={`project ${project.name}`} />
        <button type="button" class="proj-summary" aria-expanded={editing} onClick={() => onEdit(!editing)}>
          <Swatch color={project.color} />
          <span class="proj-name">{project.name}</span>
          {client && <span class="muted">{client.name}</span>}
          <SpaceTag label={space} />
          {!project.active && <Pill tone="quiet">Archived</Pill>}
          <span class="muted proj-facts">{[project.billable ? 'Billable' : '', rate].filter(Boolean).join(' · ')}</span>
        </button>
        <span class="row-actions">
          <MenuButton
            label={`More actions for project ${project.name}`}
            icon={<IconMore />}
            items={[
              { label: 'Edit', icon: <IconEdit />, onSelect: () => onEdit(true) },
              { label: project.active ? 'Archive' : 'Restore', icon: project.active ? <IconArchive /> : <IconRestore />, onSelect: () => save({ active: !project.active }) },
              ...(env.others.length > 0 && project.active ? [{ label: 'Move to space…', icon: <IconMore />, onSelect: () => setMoving(true) }] : []),
              { label: 'Delete', icon: <IconTrash />, danger: true, onSelect: () => setDeleting(true) },
            ]}
          />
        </span>
      </div>
      <MovePanel kind="project" name={project.name} data={data} env={env} open={moving} setOpen={setMoving} projectId={project.id} />
      {editing && (
        <div class="proj-edit" role="group" aria-label={`Edit ${project.name}`}>
          <input type="color" aria-label={`Colour of ${project.name}`} value={project.color} onChange={(e) => save({ color: (e.target as HTMLInputElement).value })} />
          <input type="text" class="name" aria-label={`Name of ${project.name}`} defaultValue={project.name} key={project.name} onChange={(e) => save({ name: (e.target as HTMLInputElement).value })} />
          <select aria-label={`Client of ${project.name}`} value={project.client_id ?? ''} onChange={(e) => save({ client_id: (e.target as HTMLSelectElement).value || null })}>
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? ' (archived)' : ''}
              </option>
            ))}
          </select>
          <label class="check">
            <input type="checkbox" aria-label={`Billable ${project.name}`} checked={project.billable} onChange={(e) => save({ billable: (e.target as HTMLInputElement).checked })} />
            <span>Billable</span>
          </label>
          <input
            type="number"
            class="rate"
            min="0"
            step="any"
            aria-label={`Hourly rate of ${project.name}`}
            placeholder="Rate"
            defaultValue={project.rate ?? ''}
            key={project.rate ?? 'none'}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value.trim();
              save({ rate: v === '' ? null : Number(v) });
            }}
          />
          <input type="text" class="currency" maxLength={3} aria-label={`Currency of ${project.name}`} defaultValue={project.currency} key={project.currency} onChange={(e) => save({ currency: (e.target as HTMLInputElement).value })} />
          <Button onClick={() => onEdit(false)}>Done</Button>
        </div>
      )}
      <DeleteWithMove
        open={deleting}
        setOpen={setDeleting}
        what="project"
        name={project.name}
        used={projectEntryCount(data.privateDoc, project.id)}
        noun="entries"
        options={data.projects.filter((p) => p.id !== project.id && p.active).map((p) => ({ id: p.id, name: p.name }))}
        move={(to) => moveProjectEntries(data.privateDoc, project.id, to)}
        remove={() => void deleteProject(data.doc, project.id)}
        data={data}
      />
      {error ? (
        <span class="error full" role="alert">
          {error}
        </span>
      ) : null}
    </li>
  );
}

function ClientRow({ client, data, space, env, sel, editing, onEdit }: { client: ClientRecord; data: TimeData; space?: string; env: MoveEnv; sel: SelectionApi } & EditableRow) {
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  return (
    <li class={client.archived ? 'proj-row row-host archived' : 'proj-row row-host'}>
      <div class="proj-line">
        <RowCheck sel={sel} k={itemKey('c', data.spaceId, client.id)} label={`client ${client.name}`} />
        <button type="button" class="proj-summary" aria-expanded={editing} onClick={() => onEdit(!editing)}>
          <span class="proj-name">{client.name}</span>
          <SpaceTag label={space} />
          {client.archived && <Pill tone="quiet">Archived</Pill>}
        </button>
        <span class="row-actions">
          <MenuButton
            label={`More actions for client ${client.name}`}
            icon={<IconMore />}
            items={[
              { label: 'Edit', icon: <IconEdit />, onSelect: () => onEdit(true) },
              { label: client.archived ? 'Restore' : 'Archive', icon: client.archived ? <IconRestore /> : <IconArchive />, onSelect: () => updateClient(data.doc, client.id, { archived: !client.archived }) },
              ...(env.others.length > 0 && !client.archived ? [{ label: 'Move to space…', icon: <IconMore />, onSelect: () => setMoving(true) }] : []),
              { label: 'Delete', icon: <IconTrash />, danger: true, onSelect: () => setDeleting(true) },
            ]}
          />
        </span>
      </div>
      <MovePanel kind="client" name={client.name} data={data} env={env} open={moving} setOpen={setMoving} clientId={client.id} />
      {editing && (
        <div class="proj-edit" role="group" aria-label={`Edit client ${client.name}`}>
          <input type="text" class="name" aria-label={`Name of client ${client.name}`} defaultValue={client.name} key={client.name} onChange={(e) => updateClient(data.doc, client.id, { name: (e.target as HTMLInputElement).value })} />
          <Button onClick={() => onEdit(false)}>Done</Button>
        </div>
      )}
      <DeleteWithMove
        open={deleting}
        setOpen={setDeleting}
        what="client"
        name={client.name}
        used={clientProjectCount(data.doc, client.id)}
        noun="projects"
        options={data.clients.filter((c) => c.id !== client.id && !c.archived).map((c) => ({ id: c.id, name: c.name }))}
        move={(to) => moveClientProjects(data.doc, client.id, to)}
        remove={() => void deleteClient(data.doc, client.id)}
        data={data}
      />
    </li>
  );
}

/** Organize (F-33x): the body of the Organize section of Settings; projects, clients, tags and the sections other modules register. */
export function OrganizeBody() {
  const all = useAllTime();
  const { spaces } = useApp();
  const spaceName = useSpaceName();
  const [showArchived, setShowArchived] = useState(false);
  const sel = useSelection();
  const [newProject, setNewProject] = useState('');
  const [newProjectClient, setNewProjectClient] = useState('');
  const [newClient, setNewClient] = useState('');
  // New items go to the space chosen here; it follows the filter and otherwise the last used space.
  const [pick, setPick] = useState('');
  /** The row whose edit panel is open (`space:id`); a new project or client opens at once. */
  const [editing, setEditing] = useState<string | null>(null);
  useSearchTarget(['project', 'client'], (t) => {
    setShowArchived(true);
    setEditing(`${t.spaceId}:${t.id}`);
  });
  const edit = (key: string) => ({ editing: editing === key, onEdit: (open: boolean) => setEditing(open ? key : editing === key ? null : editing) });
  const target = all.slices.get(all.filter !== 'all' ? all.filter : pick) ?? all.data;
  const shown = all.filter === 'all' ? [...all.slices.values()] : [all.slices.get(all.filter) ?? all.data];
  const handles: Spaces = new Map([...all.slices].map(([id, d]) => [id, { doc: d.doc, privateDoc: d.privateDoc }]));
  const envOf = (d: TimeData): MoveEnv => ({ handles, others: spaces.filter((sp) => sp.id !== d.spaceId && all.slices.has(sp.id)).map((sp) => ({ id: sp.id, name: sp.name })) });
  const label = (d: TimeData): string | undefined => (all.multi ? spaceName(d.spaceId) : undefined);
  const projects = shown.flatMap((d) => d.projects.filter((p) => showArchived || p.active).map((p) => ({ p, d })));
  const clients = shown.flatMap((d) => d.clients.filter((c) => showArchived || !c.archived).map((c) => ({ c, d })));
  const byName = (a: { d: TimeData }, b: { d: TimeData }, x: string, y: string): number => x.localeCompare(y) || spaceName(a.d.spaceId).localeCompare(spaceName(b.d.spaceId));
  projects.sort((a, b) => byName(a, b, a.p.name, b.p.name));
  clients.sort((a, b) => byName(a, b, a.c.name, b.c.name));
  const movable = spaces.filter((sp) => all.slices.has(sp.id)).map((sp) => ({ id: sp.id, name: sp.name }));
  usePageSelect({ active: sel.active, disabled: movable.length < 2 && !sel.active, toggle: () => (sel.active ? sel.clear() : sel.start()) });
  const addProject = (): void => {
    const id = createProject(target.doc, { name: newProject, client_id: newProjectClient || null });
    if (id) {
      setNewProject('');
      setEditing(`${target.spaceId}:${id}`);
    }
  };
  const addClient = (): void => {
    const id = createClient(target.doc, newClient);
    if (id) {
      setNewClient('');
      setEditing(`${target.spaceId}:${id}`);
    }
  };
  const spacePick = all.multi ? (
    <select aria-label="Space for new items" value={target.spaceId} disabled={all.filter !== 'all'} onChange={(e) => { setPick((e.target as HTMLSelectElement).value); setNewProjectClient(''); }}>
      {spaces.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  ) : null;

  return (
    <div class={sel.active ? 'projects-page bulk-scope selecting' : 'projects-page'}>
      {sel.active && <MoveSelectedBar sel={sel} handles={handles} data={all.data} spaceIds={movable} />}
      <div class="row">
        <SpaceFilter />
      </div>
      <label class="check">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived((e.target as HTMLInputElement).checked)} />
        <span>Show archived</span>
      </label>

      <h2>Projects</h2>
      <div class="row">
        <input
          type="text"
          aria-label="New project name"
          placeholder="New project"
          value={newProject}
          onInput={(e) => setNewProject((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && addProject()}
        />
        {spacePick}
        <select aria-label="New project client" value={newProjectClient} onChange={(e) => setNewProjectClient((e.target as HTMLSelectElement).value)}>
          <option value="">No client</option>
          {target.clients
            .filter((c) => !c.archived)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <Button variant="primary" onClick={addProject}>
          Add project
        </Button>
      </div>
      {projects.length === 0 ? (
        <p class="empty">No projects yet.</p>
      ) : (
        <ul class="proj-list">
          {projects.map(({ p, d }) => (
            <ProjectRow key={`${d.spaceId}:${p.id}`} project={p} data={d} space={label(d)} env={envOf(d)} sel={sel} {...edit(`${d.spaceId}:${p.id}`)} />
          ))}
        </ul>
      )}

      <h2>Clients</h2>
      <div class="row">
        <input type="text" aria-label="New client name" placeholder="New client" value={newClient} onInput={(e) => setNewClient((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && addClient()} />
        {spacePick}
        <Button variant="primary" onClick={addClient}>
          Add client
        </Button>
      </div>
      {clients.length === 0 ? (
        <p class="empty">No clients yet.</p>
      ) : (
        <ul class="proj-list">
          {clients.map(({ c, d }) => (
            <ClientRow key={`${d.spaceId}:${c.id}`} client={c} data={d} space={label(d)} env={envOf(d)} sel={sel} {...edit(`${d.spaceId}:${c.id}`)} />
          ))}
        </ul>
      )}

      <h2>Tags across entries, notes and tasks</h2>
      <TagManager spaceIds={shown.map((d) => d.spaceId)} selection={sel} />

      <Sections page="organize" />
    </div>
  );
}
