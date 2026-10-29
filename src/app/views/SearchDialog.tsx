import { useEffect, useMemo, useState } from 'preact/hooks';
import { registerCommand } from '../commands';
import { useApp } from '../context';
import { registerGlobal } from '../registry';
import { rankItems } from '../../core/search';
import { allSearchSources, registerSearchSource, type SearchEntry, SEARCH_GROUPS, setSearchTarget } from '../search-sources';
import { allTagSources } from '../tag-sources';
import { Dialog } from '../ui';

const OPEN_EVENT = 'app:search-everything';
const PER_GROUP = 20;

function openSearch(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

// Tags are shared by entries, notes and tasks, so the tag sources already know them.
registerSearchSource({
  id: 'tags',
  collect(app, spaceId) {
    const seen = new Map<string, string>();
    for (const src of allTagSources()) for (const [key, t] of src.tags(app, spaceId)) if (!seen.has(key)) seen.set(key, t.name);
    return [...seen].map(([key, name]) => ({
      kind: 'tag',
      spaceId,
      id: key,
      title: name,
      open: () => {
        setSearchTarget({ kind: 'tag', spaceId, id: key });
        location.hash = '#/settings/organize';
      },
    }));
  },
});

registerCommand({ id: 'search.all', title: 'Search everything', shortcuts: ['Ctrl+Shift+F'], run: () => openSearch() });

/** Every searchable item of every kept space, rebuilt when a document changes while the dialog is open. */
function useItems(): SearchEntry[] {
  const app = useApp();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let timer: number | undefined;
    const bump = (): void => {
      clearTimeout(timer);
      timer = window.setTimeout(() => setVersion((v) => v + 1), 150);
    };
    const docs = [...app.spaceDocs.values(), ...app.privateDocs.values()];
    for (const d of docs) d.on('update', bump);
    return () => {
      clearTimeout(timer);
      for (const d of docs) d.off('update', bump);
    };
  }, [app.spaceDocs, app.privateDocs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => app.spaces.flatMap((s) => allSearchSources().flatMap((src) => src.collect(app, s.id))), [app.spaces, app.spaceDocs, app.privateDocs, version]);
}

function SearchBody({ onClose }: { onClose(): void }) {
  const app = useApp();
  const items = useItems();
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<ReadonlySet<string>>(new Set());
  const [spaceIds, setSpaceIds] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState(0);
  const names = useMemo(() => new Map(app.spaces.map((s) => [s.id, s.name])), [app.spaces]);
  const results = useMemo(() => {
    const kinds = new Set(SEARCH_GROUPS.filter((g) => groups.size === 0 || groups.has(g.id)).flatMap((g) => g.kinds));
    const pool = items.filter((i) => kinds.has(i.kind) && (spaceIds.size === 0 || spaceIds.has(i.spaceId)));
    return rankItems(pool, query, names);
  }, [items, query, groups, spaceIds, names]);
  const shown = useMemo(
    () =>
      SEARCH_GROUPS.map((g) => ({ group: g, hits: results.filter((r) => g.kinds.includes(r.item.kind)).slice(0, PER_GROUP) })).filter((x) => x.hits.length > 0),
    [results],
  );
  const flat = shown.flatMap((x) => x.hits);
  useEffect(() => setActive(0), [query, groups, spaceIds]);
  const choose = (i: number): void => {
    const hit = flat[i];
    if (!hit) return;
    onClose();
    setTimeout(() => hit.item.open(), 0);
  };
  const toggle = (set: ReadonlySet<string>, id: string, put: (s: ReadonlySet<string>) => void): void => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    put(next);
  };
  let index = -1;
  return (
    <Dialog class="palette search-dialog" label="Search everything" onClose={onClose}>
      <input
        class="palette-input"
        aria-label="Search query"
        role="combobox"
        aria-expanded="true"
        aria-controls="search-list"
        aria-activedescendant={flat[active] ? `hit-${active}` : undefined}
        placeholder="Search everything…"
        value={query}
        autoFocus
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, Math.max(flat.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(active);
          }
        }}
      />
      <div class="row search-chips" role="group" aria-label="Filters">
        {SEARCH_GROUPS.map((g) => (
          <button key={g.id} type="button" class={groups.has(g.id) ? 'chip on' : 'chip'} aria-pressed={groups.has(g.id)} onClick={() => toggle(groups, g.id, setGroups)}>
            {g.label}
          </button>
        ))}
        {app.spaces.length > 1 &&
          app.spaces.map((s) => (
            <button key={s.id} type="button" class={spaceIds.has(s.id) ? 'chip on' : 'chip'} aria-pressed={spaceIds.has(s.id)} onClick={() => toggle(spaceIds, s.id, setSpaceIds)}>
              {s.name}
            </button>
          ))}
      </div>
      <div id="search-list" role="listbox" class="search-results">
        {shown.map(({ group, hits }) => (
          <section key={group.id} aria-label={group.label}>
            <h3 class="search-group">{group.label}</h3>
            <ul class="palette-list">
              {hits.map((r) => {
                const i = ++index;
                return (
                  <li
                    key={`${r.item.spaceId}:${r.item.kind}:${r.item.id}`}
                    id={`hit-${i}`}
                    role="option"
                    aria-selected={i === active}
                    class={i === active ? 'active search-hit' : 'search-hit'}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(i);
                    }}
                  >
                    <span class="search-main">
                      <span class="search-title">{r.item.title || '(no title)'}</span>
                      {r.snippet && <span class="muted search-snippet">{r.snippet}</span>}
                    </span>
                    {app.spaces.length > 1 && <span class="muted space-tag">{names.get(r.item.spaceId)}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {query.trim() && flat.length === 0 && <p class="palette-empty">Nothing matches.</p>}
      </div>
      <p class="hint">Words in any order, “phrases”, #tag. ↑ ↓ to choose, Enter to open, Esc to close.</p>
    </Dialog>
  );
}

function SearchHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (): void => setOpen(true);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  return open ? <SearchBody onClose={() => setOpen(false)} /> : null;
}

registerGlobal({ id: 'search-everything', component: SearchHost });
