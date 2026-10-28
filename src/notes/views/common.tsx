import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { buildIndex, foldersMap, notesMap, type NoteIndex } from '../note-store';

/**
 * The note indexes of several space documents, by space id, rebuilt when any of their notes change.
 * Pass only the spaces to show: every document passed is observed and indexed.
 */
export function useNoteIndexes(docs: ReadonlyMap<string, Y.Doc>): ReadonlyMap<string, NoteIndex> {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1);
    const types = [...docs.values()].flatMap((d) => [notesMap(d), foldersMap(d)] as unknown as Y.AbstractType<unknown>[]);
    for (const t of types) t.observeDeep(bump);
    return () => {
      for (const t of types) t.unobserveDeep(bump);
    };
  }, [docs]);
  return useMemo(() => new Map([...docs].map(([id, d]) => [id, buildIndex(d)] as const)), [docs, version]);
}

export interface CommitInputProps {
  value: string;
  label: string;
  onCommit(value: string): void;
  onCancel?(): void;
  autoFocus?: boolean;
  class?: string;
  placeholder?: string;
  /** Select the text (or the part before `.md`) when focused. */
  selectName?: boolean;
  /** Commit on Enter or blur even when the text is unchanged (a new item keeps its suggested name). */
  commitUnchanged?: boolean;
  /** Called after Enter has committed; the input keeps focus then (by default it blurs). */
  onEnter?(): void;
}

/**
 * A text input that commits on Enter or blur and reverts on Escape. Follows outside changes
 * while not being edited, so a remote edit shows up unless the user is typing.
 */
export function CommitInput(p: CommitInputProps) {
  const [draft, setDraft] = useState(p.value);
  const editing = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing.current) setDraft(p.value);
  }, [p.value]);
  // Layout effect: focus lands before the first paint, so the first keystroke is not lost.
  useLayoutEffect(() => {
    if (!p.autoFocus || !ref.current) return;
    ref.current.focus();
    if (p.selectName) {
      const end = p.value.toLowerCase().endsWith('.md') ? p.value.length - 3 : p.value.length;
      const start = p.value.lastIndexOf('/') + 1;
      ref.current.setSelectionRange(start, end);
    } else ref.current.select();
  }, [p.autoFocus]);
  const commit = (): void => {
    if (!editing.current) return;
    editing.current = false;
    if (draft !== p.value || p.commitUnchanged) p.onCommit(draft);
    else p.onCancel?.();
  };
  return (
    <input
      ref={ref}
      class={p.class}
      type="text"
      aria-label={p.label}
      placeholder={p.placeholder}
      value={draft}
      onFocus={() => {
        editing.current = true;
      }}
      onInput={(e) => {
        editing.current = true;
        setDraft((e.target as HTMLInputElement).value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          if (p.onEnter) p.onEnter();
          else (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          editing.current = false;
          setDraft(p.value);
          p.onCancel?.();
          e.stopPropagation();
        }
      }}
    />
  );
}
