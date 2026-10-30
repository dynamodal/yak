import { useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { Button } from '../app/ui';
import { folderMirrorSupported } from './folder';
import { mirrorSpaces, type MirrorResult } from './service';
import { useMirror, watchFolder } from './runtime';

const when = (iso: string | undefined): string => (iso ? new Date(iso).toLocaleString() : 'not yet');

const FOLDER_TEXT: Record<string, string> = {
  none: 'No folder chosen.',
  granted: 'Mirroring.',
  prompt: 'Access to the folder was lost when the page was closed. Allow it to continue.',
  denied: 'Access to the folder was refused. Choose the folder again.',
};

/** The last result and when: "OK, 3:05 PM" or "Failed, 3:05 PM: the reason" (#95). Before the result was kept, only a time of the last good pass is known. */
function resultText(r: MirrorResult | undefined, lastRunAt: string | undefined): string {
  if (!r) return lastRunAt ? `Last run OK: ${when(lastRunAt)}` : 'Not run yet';
  return r.ok ? `Last run OK: ${when(r.at)}` : `Last run failed: ${when(r.at)}. ${r.error ?? 'Unknown error'}`;
}

/** Pick a folder; notes appear there as Markdown files and edits made elsewhere come back. */
export function MirrorView() {
  const rt = useMirror();
  const { state, service, folder } = rt;
  const { spaces } = useApp();
  const [error, setError] = useState('');
  const act = (fn: () => Promise<unknown>): void => {
    setError('');
    fn().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const chosen = state.folder.state !== 'none' && state.folder.state !== 'unsupported';
  const folders = new Map(mirrorSpaces(rt.spaces, state.excluded).map((s) => [s.id, s.folder]));

  if (!folderMirrorSupported() && state.folder.state === 'unsupported') {
    return (
      <div class="mirror">
        <p class="hint">Not available in this browser: it needs folder access.</p>
      </div>
    );
  }

  return (
    <div class="mirror">
      <p class="help-link"><a href="#/help/obsidian">How this works</a></p>
      <div class="card">
        <h3>Folder</h3>
        <p class={`mirror-status ${state.folder.state === 'granted' ? 'ok' : ''}`} data-folder-state={state.folder.state}>
          {chosen ? <strong>{state.folder.name}</strong> : null} {state.folder.error ?? FOLDER_TEXT[state.folder.state] ?? ''}
        </p>
        <div class="row">
          {state.folder.state === 'prompt' ? (
            <Button
              onClick={() =>
                act(async () => {
                  await folder.requestAccess();
                  await service.refresh();
                  await watchFolder(rt);
                  await service.run();
                })
              }
            >
              Allow access
            </Button>
          ) : null}
          <Button
            onClick={() =>
              act(async () => {
                if (!(await folder.choose())) return;
                await service.reset();
                await watchFolder(rt);
                await service.run();
              })
            }
          >
            {chosen ? 'Change folder' : 'Choose folder'}
          </Button>
          {chosen ? (
            <Button
              onClick={() =>
                act(async () => {
                  await folder.forget();
                  await service.reset();
                })
              }
            >
              Stop mirroring
            </Button>
          ) : null}
        </div>
        <p class="hint">Markdown files already in a space's folder are added to the app as notes. Nothing in the folder is deleted when you stop.</p>
        <p class="hint">In a space shared with another person, deleting a file in the folder deletes the note for everyone in the share.</p>
      </div>
      {chosen ? (
        <div class="card">
          <h3>Spaces</h3>
          {spaces.map((s) => (
            <label class="row" key={s.id}>
              <input type="checkbox" checked={!state.excluded.includes(s.id)} onChange={(e) => act(() => service.setExcluded(s.id, !(e.target as HTMLInputElement).checked))} />
              <span>{s.name}</span>
              <span class="hint">{folders.has(s.id) ? `${folders.get(s.id)}/` : 'not mirrored'}</span>
            </label>
          ))}
        </div>
      ) : null}
      {chosen ? (
        <div class="card">
          <h3>Status</h3>
          <p data-mirror-run data-mirror-result={state.running ? 'running' : state.lastResult ? (state.lastResult.ok ? 'ok' : 'failed') : 'none'}>
            {state.running ? 'Mirroring…' : resultText(state.lastResult, state.lastRunAt)}
          </p>
          {state.error ? (
            <p class="error" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.errors.length ? (
            <ul class="error" role="alert">
              {state.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          <div class="row">
            <Button onClick={() => act(() => service.run())}>Check now</Button>
          </div>
        </div>
      ) : null}
      {state.conflicts.length ? (
        <div class="card" aria-label="Conflicts">
          <h3>Conflicts</h3>
          <p class="hint">Both the app and the file changed. The app's version kept its name; the file's version was saved as a copy. Compare them and delete one.</p>
          <ul data-conflicts>
            {state.conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button onClick={() => act(() => service.dismissConflicts())}>Dismiss</Button>
        </div>
      ) : null}
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
