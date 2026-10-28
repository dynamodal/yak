import { useEffect, useMemo, useState } from 'preact/hooks';
import * as Y from 'yjs';
import { APP_NAME } from '../constants';
import type { EventBus } from '../core/bus';
import type { DocumentStore } from '../core/doc-store';
import type { SyncService } from '../sync/sync-service';
import type { AccountState } from './account-state';
import { AppContext, type AppContextValue } from './context';
import { useNotices } from './hooks';
import { TopNav } from './Nav';
import { NAV_GROUPS, legacyRoute, navModel } from './nav';
import { hiddenRoute, useHiddenModules } from './features';
import { allBanners, allGlobals, allHeaderItems, allViews, joinedViews, registeredViews } from './registry';
import { savedJoinedView } from './timer-views';
import { navigate, parseHash, useRoute } from './router';
import { Button, IconArrowLeft, ToastHost } from './ui';
import { ConflictWatch } from './ConflictWatch';
import { SyncStatus } from './SyncStatus';
import { useTabBadges } from './tab-badges';
import { Welcome } from './Welcome';
import { rememberShare } from './pending-share';
import { safeStorage } from './join';
import { KeyPromptHost } from './views/KeyPromptHost';
import { ShareJoin } from './views/ShareJoin';

const SPACE_KEY = 'app-active-space';
export interface AppProps {
  store: DocumentStore;
  sync: SyncService;
  bus: EventBus;
  deviceId: string;
  account: AccountState;
  /** First start: no space exists yet and the person has not chosen how to begin. */
  welcome?: boolean;
}

function savedSpace(): string | undefined {
  try {
    return localStorage.getItem(SPACE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** First stop for the keyboard: jumps past the header to the page. A button, because a "#main" link would change the hash route. */
function SkipLink() {
  return (
    <button type="button" class="skip-link" onClick={() => document.getElementById('main')?.focus()}>
      Skip to content
    </button>
  );
}

export function App(props: AppProps) {
  const [snapshot, setSnapshot] = useState(props.account.current);
  useEffect(() => props.account.subscribe(setSnapshot), [props.account]);
  const [chosen, setSpace] = useState(savedSpace);
  // The chosen space, or the first one when it is gone (renamed spaces keep their id).
  const spaceId = snapshot.spaces.some((s) => s.id === chosen) ? (chosen as string) : (snapshot.spaces[0]?.id ?? '');
  const route = useRoute();
  // A share link opened before this device is set up is kept until it is used (F-324).
  useEffect(() => {
    if (route[0] === 'share' && route[1]) rememberShare(safeStorage(), route[1]);
  }, [route[0], route[1]]);
  // Re-render when this device's Features change; `allViews()` and the commands filter themselves.
  useHiddenModules();
  const pendingNotices = useNotices().length;
  const welcome = props.welcome === true && snapshot.allSpaces.length === 0;
  const noSpaces = snapshot.spaces.length === 0;
  const placeholder = useMemo(() => new Y.Doc(), []);
  // A device that keeps no space yet (it has just joined) shows only Settings, where its spaces are chosen; no other view works without a space's documents.
  const views = noSpaces ? allViews().filter((v) => v.group === 'settings').sort((a, b) => Number(b.path === 'settings') - Number(a.path === 'settings')) : allViews();
  const badges = useTabBadges(pendingNotices);

  // Old addresses open their place in Settings: `#/manage/<x>` and `#/<x>` (`#/devices`, …) become `#/settings/<x>`,
  // the folded pages (General, Spaces, Sharing, Security, Features) become `#/settings`, and Backups and History are one page, `#/settings/backup`.
  const oldRoute = !welcome ? legacyRoute(route, allViews()) : undefined;
  useEffect(() => {
    // Only while the address is still the old route: a later navigation must not be overwritten.
    if (oldRoute && parseHash(location.hash).join('/') === route.join('/')) location.replace(`#/${oldRoute.map(encodeURIComponent).join('/')}`);
  }, [oldRoute?.join('/'), route.join('/')]);

  // A page this device hides sends you to the timer, or to Settings for a Settings page (F-309).
  const onHiddenPage = !welcome && hiddenRoute(route, registeredViews());
  useEffect(() => {
    if (onHiddenPage && parseHash(location.hash).join('/') === route.join('/')) location.replace(route[0] === 'settings' ? '#/settings' : '#/time');
  }, [onHiddenPage, route.join('/')]);

  // `#/time` alone opens the view used last; when that is a joined one (Reports), say so in the address.
  useEffect(() => {
    if (welcome || noSpaces || route.length !== 1 || route[0] !== 'time') return;
    const saved = savedJoinedView('timer');
    if (saved && parseHash(location.hash).join('/') === route.join('/')) location.replace(`#/time/${encodeURIComponent(saved)}`);
  }, [welcome, noSpaces, route.join('/')]);

  const setSpaceId = (id: string): void => {
    setSpace(id);
    try {
      localStorage.setItem(SPACE_KEY, id);
    } catch {
      // ignore
    }
  };

  const doc = snapshot.spaceDocs.get(spaceId) ?? (noSpaces ? placeholder : undefined);
  const privateDoc = snapshot.privateDocs.get(spaceId) ?? (noSpaces ? placeholder : undefined);
  const value = useMemo<AppContextValue | null>(
    () =>
      doc && privateDoc
        ? {
            store: props.store,
            sync: props.sync,
            bus: props.bus,
            deviceId: props.deviceId,
            account: props.account.doc,
            accountId: props.account.id,
            spaces: snapshot.spaces,
            allSpaces: snapshot.allSpaces,
            spaceDocs: snapshot.spaceDocs,
            privateDocs: snapshot.privateDocs,
            spaceId,
            setSpaceId,
            doc,
            privateDoc,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, privateDoc, spaceId, snapshot, props.store, props.sync],
  );
  if (!value) return <p class="empty">Loading…</p>;

  if (welcome) {
    // Before a choice there is nothing to track: the welcome, Help and About, and Backup & restore for a restore.
    const Backups = allViews().find((v) => v.id === 'backup')?.component;
    const Help = allViews().find((v) => v.id === 'help')?.component;
    const restoring = (route[0] === 'backup' || route[0] === 'backups') && Backups;
    const helping = route[0] === 'help' && Help;
    return (
      <AppContext.Provider value={value}>
        <header class="topbar">
          <span class="brand">
            <img class="brand-icon" src="/icon.svg" alt="" width="24" height="24" />
            {APP_NAME}
          </span>
          <div class="topbar-end">
            {allHeaderItems('welcome').map((h) => (
              <h.component key={h.id} />
            ))}
          </div>
        </header>
        <main class="view">
          {restoring ? (
            <>
              <Button onClick={() => navigate('')}><IconArrowLeft /> Back to the welcome</Button>
              <Backups params={[]} />
            </>
          ) : helping ? (
            <>
              <Button onClick={() => navigate('')}><IconArrowLeft /> Back to the welcome</Button>
              <Help params={route.slice(1)} />
            </>
          ) : (
            <Welcome onStarted={() => void props.account.refresh()} />
          )}
        </main>
        <KeyPromptHost />
        <ToastHost />
      </AppContext.Provider>
    );
  }

  const nav = navModel(views, route);
  const current = nav.current;
  const first = nav.places[0];
  const home = first ? (first.kind === 'page' ? `#/${first.view.path}` : first.kind === 'link' ? first.href : '#/') : '#/';
  const landing = NAV_GROUPS.find((g) => g.landing && g.id === route[0]);
  const params = landing ? route.slice(2) : current && current.path === route[0] ? route.slice(1) : [];
  // A view that joins a page's switch (Reports on the Time page) is shown at `#/<page>/<its path>`; a bare `#/time` opens the one used last (R-335).
  const joinedPath = current && current.path === route[0] ? (params[0] ?? savedJoinedView(current.id)) : undefined;
  const joined = current && joinedPath !== undefined ? joinedViews(current.id).find((v) => v.path === joinedPath) : undefined;
  const View = joined ? joined.component : current?.component;
  const viewParams = joined ? params.slice(params[0] === undefined ? 0 : 1) : params;
  const page = route[0] === 'share' ? (
    <ShareJoin code={route[1] ?? ''} />
  ) : View ? (
    <View params={viewParams} />
  ) : (
    <p class="empty">No views registered.</p>
  );

  return (
    <AppContext.Provider value={value}>
      <SkipLink />
      <header class="topbar">
        <a class="brand" href={home}>
          <img class="brand-icon" src="/icon.svg" alt="" width="24" height="24" />
          <span class="brand-name">{APP_NAME}</span>
        </a>
        <TopNav model={nav} badges={badges} />
        <div class="topbar-end">
          {!noSpaces &&
            allHeaderItems().map((h) => (
              <h.component key={h.id} />
            ))}
          <SyncStatus pendingNotices={pendingNotices} />
        </div>
      </header>
      {!noSpaces &&
        allGlobals().map((g) => (
          <g.component key={g.id} />
        ))}
      {!noSpaces && <ConflictWatch />}
      {!noSpaces &&
        allBanners().map((Banner, i) => (
          <Banner key={i} />
        ))}
      <main class="view" id="main" tabIndex={-1}>{page}</main>
      <KeyPromptHost />
      <ToastHost />
    </AppContext.Provider>
  );
}
