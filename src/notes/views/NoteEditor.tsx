import { useEffect, useRef, useState } from 'preact/hooks';
import * as Y from 'yjs';
import type { EditorView } from '@codemirror/view';
import type { StateCommand } from '@codemirror/state';
import type { AttachmentHost } from '../../core/blobs/host';
import { FileButton, toast } from '../../app/ui';

export interface NoteEditorProps {
  ytext: Y.Text;
  mode: 'live' | 'source';
  /** Live mode: hide the YAML front matter (the Properties table shows it). */
  hideFrontMatter: boolean;
  onOpenLink(target: string): void;
  onTag(tag: string): void;
  onMakeTask(title: string, done: boolean): string | null;
  /** Attached files of the note's space. */
  files?: AttachmentHost;
  /** Called (debounced) after edits made on this device, to stamp `updated_at`. */
  onLocalEdit(): void;
}

/** Dispatched on a `.note-editor` element to insert text at the cursor. */
export const INSERT_EVENT = 'note-editor:insert';

/** Dispatched on a `.note-editor` element with a text offset (the event's `detail`) to move the cursor there and scroll to it. */
export const GOTO_EVENT = 'note-editor:goto';
/** Dispatched on the editor element to put the cursor in the text. */
export const FOCUS_EVENT = 'note-editor:focus';

/** Toolbar buttons (phones): label, accessible name and the command to run. */
const TOOLS: readonly { label: string; name: string; run(c: typeof import('../editor-commands')): StateCommand }[] = [
  { label: 'B', name: 'Bold', run: (c) => c.toggleWrap('**') },
  { label: 'I', name: 'Italic', run: (c) => c.toggleWrap('*') },
  { label: 'H', name: 'Heading', run: (c) => c.cycleHeading },
  { label: '•', name: 'Bullet', run: (c) => c.toggleBullet },
  { label: '☑', name: 'Checkbox', run: (c) => c.cycleList },
  { label: '[[]]', name: 'Link', run: (c) => c.wrapLink },
  { label: '→', name: 'Indent', run: (c) => c.indentLines(1) },
  { label: '←', name: 'Outdent', run: (c) => c.indentLines(-1) },
];

function showFileMessages(m: { notices: string[]; errors: string[] }): void {
  for (const e of m.errors) toast(e);
  for (const n of m.notices) toast(n);
}

/** Mounts CodeMirror for one Y.Text; remounts only when the Y.Text changes. */
/** A visual viewport at least this much shorter than before means the on-screen keyboard is up. */
const KEYBOARD_PX = 120;

export function NoteEditor(p: NoteEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const props = useRef(p);
  props.current = p;
  const viewRef = useRef<EditorView | undefined>(undefined);
  const undoRef = useRef<Y.UndoManager | undefined>(undefined);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const undoManager = new Y.UndoManager(p.ytext);
    undoRef.current = undoManager;
    let view: EditorView | undefined;
    let disposed = false;
    // CodeMirror is loaded on first use so the rest of the app starts without it.
    void import('../editor').then(({ createEditor }) => {
      if (disposed) return;
      view = createEditor(parent, {
        ytext: p.ytext,
        undoManager,
        mode: props.current.mode,
        hideFrontMatter: props.current.hideFrontMatter,
        onOpenLink: (t) => props.current.onOpenLink(t),
        onTag: (t) => props.current.onTag(t),
        onMakeTask: (t, d) => props.current.onMakeTask(t, d),
        files: props.current.files,
        onFileMessages: showFileMessages,
      });
      viewRef.current = view;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = (_e: Y.YTextEvent, tr: Y.Transaction): void => {
      if (!tr.local) return;
      clearTimeout(timer);
      timer = setTimeout(() => props.current.onLocalEdit(), 1500);
    };
    p.ytext.observe(observer);
    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        props.current.onLocalEdit();
      }
      p.ytext.unobserve(observer);
      disposed = true;
      viewRef.current = undefined;
      undoRef.current = undefined;
      view?.destroy();
      undoManager.destroy();
    };
  }, [p.ytext]);

  // Commands insert text through an event, so only this file touches the editor instance.
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const insert = (e: Event): void => {
      const view = viewRef.current;
      if (view) view.dispatch(view.state.replaceSelection(String((e as CustomEvent).detail)));
    };
    const goto = (e: Event): void => {
      const view = viewRef.current;
      if (!view) return;
      const pos = Math.min(Number((e as CustomEvent).detail) || 0, view.state.doc.length);
      void import('../editor').then(({ revealOffset }) => revealOffset(view, pos));
    };
    parent.addEventListener(INSERT_EVENT, insert);
    const focusText = (): void => viewRef.current?.focus();
    parent.addEventListener(GOTO_EVENT, goto);
    parent.addEventListener(FOCUS_EVENT, focusText);
    return () => {
      parent.removeEventListener(INSERT_EVENT, insert);
      parent.removeEventListener(GOTO_EVENT, goto);
      parent.removeEventListener(FOCUS_EVENT, focusText);
    };
  }, []);

  // Mode changes reconfigure the mounted editor; the module is already loaded once a view exists.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    void import('../editor').then(({ setEditorMode }) => setEditorMode(view, p.mode, p.hideFrontMatter));
  }, [p.mode, p.hideFrontMatter]);

  // The toolbar shows while the editor has focus and rides above the on-screen keyboard.
  const [focused, setFocused] = useState(false);
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (): void => {
      clearTimeout(t);
      setFocused(true);
    };
    // Tapping a toolbar button keeps focus (mousedown is cancelled), so a real blur means it is over.
    const off = (): void => {
      t = setTimeout(() => setFocused(false), 100);
    };
    el.addEventListener('focusin', on);
    el.addEventListener('focusout', off);
    return () => {
      clearTimeout(t);
      el.removeEventListener('focusin', on);
      el.removeEventListener('focusout', off);
    };
  }, []);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!focused || !vv) return;
    // The height before the keyboard opened: some browsers shrink the layout viewport with the keyboard, most only the visual one.
    const base = Math.max(window.innerHeight, vv.height);
    const root = document.documentElement;
    const update = (): void => {
      setLift(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
      // With the keyboard up on a short screen the page header would take the room the text needs: notes.css hides it meanwhile.
      if (base - vv.height > KEYBOARD_PX) root.setAttribute('data-note-typing', '');
      else root.removeAttribute('data-note-typing');
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.removeAttribute('data-note-typing');
    };
  }, [focused]);

  const run = (tool: (typeof TOOLS)[number]): void => {
    const view = viewRef.current;
    if (!view) return;
    void import('../editor-commands').then((c) => {
      tool.run(c)({ state: view.state, dispatch: view.dispatch });
      view.focus();
    });
  };

  return (
    <>
      <div class={`note-editor mode-${p.mode}`} ref={host} />
      {p.files && (
        <FileButton
          class="note-add-file"
          label="Add file"
          inputLabel="Add files to this note"
          multiple
          onChange={(e) => {
            const input = e.currentTarget as HTMLInputElement;
            const picked = Array.from(input.files ?? []);
            input.value = '';
            const view = viewRef.current;
            if (view && picked.length > 0) void import('../editor').then(({ addFilesToEditor }) => addFilesToEditor(view, picked));
          }}
        />
      )}
      {focused && (
        <div class="note-format-bar" role="toolbar" aria-label="Formatting" style={{ bottom: `${lift}px` }}>
          <button type="button" aria-label="Undo" title="Undo" onMouseDown={(e) => e.preventDefault()} onClick={() => undoRef.current?.undo()}>
            ↶
          </button>
          <button type="button" aria-label="Redo" title="Redo" onMouseDown={(e) => e.preventDefault()} onClick={() => undoRef.current?.redo()}>
            ↷
          </button>
          {TOOLS.map((t) => (
            <button type="button" aria-label={t.name} title={t.name} onMouseDown={(e) => e.preventDefault()} onClick={() => run(t)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
