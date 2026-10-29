import { defaultKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { Compartment, EditorState, Facet, Prec, RangeSetBuilder, StateField, type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import type { AttachmentHost, EmbedView } from '../core/blobs/host';
import { formatBytes } from '../core/blobs/limits';
import { cycleList, makeTask, setHeading, toggleTask, toggleWrap, wrapLink } from './editor-commands';
import { findFrontMatter } from './frontmatter';
import { linkAt } from './links';

/**
 * The CodeMirror 6 Markdown editor bound to a note's Y.Text. Undo and redo go through a
 * Y.UndoManager, so they only undo this device's edits; CodeMirror's own history is not used.
 *
 * Two modes, as in Obsidian (docs/decisions/notes-editor.md):
 * - **Live**: reads like a note. Markdown marks (`#`, `**`, `[[ ]]`, list dashes) are hidden except
 *   on the line being edited; task boxes are clickable; the YAML front matter is hidden because the
 *   Properties table above the editor shows it.
 * - **Source**: the text exactly as stored, YAML included, in a monospace font.
 *
 * Content-Security-Policy: CodeMirror's style-mod uses constructed style sheets only inside a
 * shadow root; in the document itself it adds a `<style>` element, which `style-src 'self'`
 * blocks. So the editor is mounted in a shadow root, and all of its styling lives in the themes
 * below (CSS custom properties from the app's tokens inherit into the shadow root).
 */

export type EditorMode = 'live' | 'source';

const baseTheme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'transparent', minHeight: '30vh', fontSize: '1rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.7' },
  '.cm-content': { padding: '0.25rem 0 4rem', caretColor: 'var(--text)', maxWidth: '46rem', margin: '0 auto' },
  '.cm-line': { padding: '0 0.25rem' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
  },
  '.cm-wikilink': { color: 'var(--accent)', cursor: 'pointer' },
  '.cm-wikilink:hover': { textDecoration: 'underline' },
  '.cm-wikilink-inert, .cm-wikilink-inert:hover': { color: 'var(--muted)', cursor: 'text', textDecoration: 'underline dotted' },
  '.cm-hashtag': { color: 'var(--accent)', backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)', borderRadius: '4px', padding: '0 2px' },
  '.cm-h1': { fontSize: '1.75em', fontWeight: '700', lineHeight: '1.3', paddingTop: '0.4em' },
  '.cm-h2': { fontSize: '1.4em', fontWeight: '700', lineHeight: '1.3', paddingTop: '0.35em' },
  '.cm-h3': { fontSize: '1.2em', fontWeight: '700', paddingTop: '0.3em' },
  '.cm-h4, .cm-h5, .cm-h6': { fontWeight: '700' },
  '.cm-quote-line': { borderLeft: '3px solid var(--border)', paddingLeft: '0.9rem !important', color: 'var(--muted)' },
  '.cm-bullet': { color: 'var(--muted)', display: 'inline-block', width: '1.1em' },
  '.cm-task': { verticalAlign: '-0.15em', margin: '0 0.45em 0 0.05em', width: '1em', height: '1em', cursor: 'pointer', accentColor: 'var(--accent)' },
  '.cm-task-done': { color: 'var(--muted)', textDecoration: 'line-through' },
  '.cm-inline-code': { fontFamily: 'var(--font-mono)', fontSize: '0.92em', backgroundColor: 'var(--surface-2)', borderRadius: '4px', padding: '0 3px' },
  '.cm-codeblock-line': { fontFamily: 'var(--font-mono)', fontSize: '0.92em', backgroundColor: 'var(--surface-2)' },
  '.cm-embed': { display: 'inline-block', maxWidth: '100%', verticalAlign: 'bottom' },
  '.cm-embed-wait, .cm-embed-missing': { color: 'var(--muted)', fontSize: '0.9em', border: '1px dashed var(--border)', borderRadius: '6px', padding: '0.1rem 0.5rem' },
  '.cm-embed-img': { display: 'block', maxWidth: '100%', height: 'auto', borderRadius: '4px' },
  '.cm-file-chip': { display: 'inline-flex', gap: '0.6rem', alignItems: 'baseline', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.15rem 0.6rem', fontSize: '0.92em', backgroundColor: 'var(--surface-2)' },
  '.cm-file-size': { color: 'var(--muted)' },
  '.cm-file-chip a': { color: 'var(--accent)' },
  '.cm-frontmatter, .cm-frontmatter *': { fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: '400', color: 'var(--muted)', textDecoration: 'none' },
});

/** Source mode: monospace and every mark visible, as the file is stored. */
const sourceTheme = EditorView.theme({
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { maxWidth: 'none' },
});

/** Markdown highlighting with the app's colour tokens, so it works in light and dark mode. */
const highlight = HighlightStyle.define([
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.labelName], color: 'var(--muted)' },
]);

// ---- wikilinks and #tags (both modes) ------------------------------------------------------------

const wikiMark = Decoration.mark({ class: 'cm-wikilink' });
const tagMark = Decoration.mark({ class: 'cm-hashtag' });
const WIKI = /!?\[\[([^[\]\n|]+?)(\|[^[\]\n]+?)?\]\]/g;

/** A link that does not open (Notes is off and it reaches no task): plain text with the reason as its title. */
const inertMark = (title: string): Decoration => Decoration.mark({ class: 'cm-wikilink cm-wikilink-inert', attributes: { title } });
const wikiDecorator = (linkTitle?: (target: string) => string | undefined): MatchDecorator =>
  new MatchDecorator({
    regexp: WIKI,
    decoration: (m) => {
      // An embed (`![[file.png]]`) is an attachment, not a link to open.
      const title = linkTitle && !m[0].startsWith('!') ? linkTitle((m[1] ?? '').split('#')[0]?.trim() ?? '') : undefined;
      return title ? inertMark(title) : wikiMark;
    },
  });
const tagDecorator = new MatchDecorator({
  regexp: /(^|[\s(,;])(#[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu,
  decorate: (add, from, to, match) => add(from + (match[1]?.length ?? 0), to, tagMark),
});

function decoratorPlugin(decorator: MatchDecorator): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(u: ViewUpdate): void {
        this.decorations = decorator.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ---- front matter -------------------------------------------------------------------------------

/** Live mode: the front matter block is hidden (Properties shows it) and the cursor skips over it. */
const hiddenFrontMatter = StateField.define<DecorationSet>({
  create: (state) => frontMatterDeco(state),
  update: (deco, tr) => (tr.docChanged ? frontMatterDeco(tr.state) : deco),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

function frontMatterDeco(state: EditorState): DecorationSet {
  const block = findFrontMatter(state.doc.toString());
  if (!block) return Decoration.none;
  const closing = state.doc.lineAt(Math.min(block.end, state.doc.length));
  return Decoration.set([Decoration.replace({ block: true }).range(0, closing.to)]);
}

/** Source mode: the YAML is shown, without Markdown styling (its `---` would otherwise read as a heading). */
const plainFrontMatter = StateField.define<DecorationSet>({
  create: (state) => plainFrontMatterDeco(state),
  update: (deco, tr) => (tr.docChanged ? plainFrontMatterDeco(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

function plainFrontMatterDeco(state: EditorState): DecorationSet {
  const block = findFrontMatter(state.doc.toString());
  if (!block) return Decoration.none;
  const closing = state.doc.lineAt(Math.min(block.end, state.doc.length));
  const b = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= closing.number; n++) b.add(state.doc.line(n).from, state.doc.line(n).from, Decoration.line({ class: 'cm-frontmatter' }));
  return b.finish();
}

// ---- live preview ------------------------------------------------------------------------------

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'cm-bullet';
    s.textContent = '•';
    return s;
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: TaskWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? 'Done; mark as not done' : 'Not done; mark as done');
    return box;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

// ---- attached files: `![[name.ext]]` ---------------------------------------------------------------

interface FileConfig {
  host: AttachmentHost;
  /** Messages from an add (notices, refusals) for the user. */
  onMessages?(m: { notices: string[]; errors: string[] }): void;
}

const fileConfig = Facet.define<FileConfig, FileConfig | undefined>({ combine: (v) => v[0] });

/** Shows an attached file: an inline image for sniffed PNG, JPEG, WebP and GIF; a chip with a download for everything else. */
class EmbedWidget extends WidgetType {
  private readonly revokers = new WeakMap<HTMLElement, () => void>();
  private readonly gone = new WeakSet<HTMLElement>();
  constructor(
    readonly host: AttachmentHost,
    readonly name: string,
    readonly width: number | undefined,
    readonly hash: string,
  ) {
    super();
  }
  eq(o: EmbedWidget): boolean {
    return o.name === this.name && o.width === this.width && o.hash === this.hash;
  }
  toDOM(): HTMLElement {
    const box = document.createElement('span');
    box.className = 'cm-embed';
    const known = this.host.lookup(this.name);
    if (known?.width && known.height && this.width === undefined) {
      box.style.aspectRatio = `${known.width} / ${known.height}`;
      box.style.width = `min(100%, ${known.width}px)`;
    }
    box.textContent = `Loading ${this.name}…`;
    box.classList.add('cm-embed-wait');
    void this.host.open(this.name).then((v) => {
      if (this.gone.has(box)) {
        if (v.kind !== 'missing') v.revoke();
        return;
      }
      this.fill(box, v);
    });
    return box;
  }
  private fill(box: HTMLElement, v: EmbedView): void {
    box.classList.remove('cm-embed-wait');
    box.replaceChildren();
    if (v.kind === 'missing') {
      box.classList.add('cm-embed-missing');
      box.textContent = v.reason === 'no-bytes' ? `${v.name} (waiting for a direct connection)` : `${v.name} (file not found)`;
      // The bytes may arrive from a peer while the note is open: show the file then.
      if (v.reason === 'no-bytes') {
        void this.host.whenStored?.(v.name).then(() => {
          if (this.gone.has(box)) return;
          void this.host.open(v.name).then((next) => {
            if (this.gone.has(box)) {
              if (next.kind !== 'missing') next.revoke();
              return;
            }
            box.classList.remove('cm-embed-missing');
            this.fill(box, next);
          });
        });
      }
      return;
    }
    this.revokers.set(box, v.revoke);
    if (v.kind === 'image') {
      const img = document.createElement('img');
      img.alt = v.name;
      img.src = v.url;
      img.className = 'cm-embed-img';
      if (this.width) img.style.width = `${this.width}px`;
      box.style.aspectRatio = '';
      box.style.width = '';
      box.appendChild(img);
      return;
    }
    box.classList.add('cm-file-chip');
    const label = document.createElement('span');
    label.className = 'cm-file-name';
    label.textContent = v.name;
    const size = document.createElement('span');
    size.className = 'cm-file-size';
    size.textContent = formatBytes(v.size);
    const a = document.createElement('a');
    a.href = v.url;
    a.download = v.name;
    a.rel = 'noopener';
    a.textContent = 'Download';
    box.append(label, size, a);
  }
  destroy(dom: HTMLElement): void {
    this.gone.add(dom);
    this.revokers.get(dom)?.();
    this.revokers.delete(dom);
  }
}

/** Put the files into the note: add them, then insert one `![[name]]` each at `pos` (default: the cursor). */
export async function addFilesToEditor(view: EditorView, files: File[], pos?: number): Promise<void> {
  const cfg = view.state.facet(fileConfig);
  if (!cfg || files.length === 0) return;
  const r = await cfg.host.add(files);
  cfg.onMessages?.({ notices: r.notices, errors: r.errors });
  if (r.names.length === 0) return;
  const at = Math.min(pos ?? view.state.selection.main.head, view.state.doc.length);
  const text = r.names.map((n) => `![[${n}]]`).join('\n');
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.paste' });
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });

/** Lines the cursor or a selection touches: their marks stay visible for editing. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number;
    const b = view.state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  return lines;
}

function livePreview(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(view);
  const fm = findFrontMatter(doc.toString());
  const bodyFrom = fm ? Math.min(fm.bodyStart, doc.length) : 0;
  const ranges: Range<Decoration>[] = [];
  const onActive = (pos: number): boolean => active.has(doc.lineAt(pos).number);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: Math.max(from, bodyFrom),
      to,
      enter: (node) => {
        const name = node.name;
        if (node.from < bodyFrom) return;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          ranges.push(Decoration.line({ class: `cm-h${heading[1]}` }).range(doc.lineAt(node.from).from));
          return;
        }
        if (name === 'FencedCode' || name === 'CodeBlock') {
          for (let n = doc.lineAt(node.from).number; n <= doc.lineAt(node.to).number; n++) {
            ranges.push(Decoration.line({ class: 'cm-codeblock-line' }).range(doc.line(n).from));
          }
          return false; // marks inside code stay as typed
        }
        if (name === 'Blockquote') {
          for (let n = doc.lineAt(node.from).number; n <= doc.lineAt(node.to).number; n++) {
            ranges.push(Decoration.line({ class: 'cm-quote-line' }).range(doc.line(n).from));
          }
          return;
        }
        if (name === 'InlineCode') {
          ranges.push(Decoration.mark({ class: 'cm-inline-code' }).range(node.from, node.to));
        }
        if (onActive(node.from)) return;
        if (name === 'HeaderMark') {
          // `## ` : the marks and the space after them.
          const end = Math.min(node.to + 1, doc.lineAt(node.from).to);
          if (end > node.from) ranges.push(hide.range(node.from, end));
        } else if (name === 'EmphasisMark' || name === 'StrikethroughMark' || name === 'QuoteMark') {
          const end = name === 'QuoteMark' && doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
          ranges.push(hide.range(node.from, end));
        } else if (name === 'CodeMark' && node.node.parent?.name === 'InlineCode') {
          ranges.push(hide.range(node.from, node.to));
        } else if (name === 'LinkMark' || name === 'URL') {
          // [text](url): only the text stays.
          if (node.node.parent?.name === 'Link') ranges.push(hide.range(node.from, node.to));
        } else if (name === 'ListMark' && node.node.parent?.parent?.name === 'BulletList') {
          const task = node.node.parent?.getChild('Task')?.getChild('TaskMarker');
          if (task) {
            const checked = /x/i.test(doc.sliceString(task.from, task.to));
            ranges.push(Decoration.replace({ widget: new TaskWidget(checked) }).range(node.from, Math.min(task.to + 1, doc.lineAt(task.from).to)));
            if (checked) {
              const line = doc.lineAt(node.from);
              if (task.to + 1 < line.to) ranges.push(Decoration.mark({ class: 'cm-task-done' }).range(task.to + 1, line.to));
            }
          } else {
            ranges.push(bullet.range(node.from, Math.min(node.to + 1, doc.lineAt(node.from).to)));
          }
        }
      },
    });
    // [[target]] and [[target|alias]]: only the name (or alias) stays.
    const text = doc.sliceString(from, to);
    for (const m of text.matchAll(WIKI)) {
      const start = from + (m.index ?? 0);
      if (start < bodyFrom || onActive(start)) continue;
      const embed = m[0].startsWith('!') ? 1 : 0;
      const files = state.facet(fileConfig);
      if (embed && files && files.host.claims((m[1] ?? '').trim())) {
        const name = (m[1] ?? '').trim();
        const w = /^\|\s*(\d{1,4})\s*$/.exec(m[2] ?? '');
        const widget = new EmbedWidget(files.host, name, w ? Number(w[1]) : undefined, files.host.lookup(name)?.hash ?? '');
        ranges.push(Decoration.replace({ widget }).range(start, start + m[0].length));
        continue;
      }
      const open = start + embed;
      const targetEnd = open + 2 + (m[1]?.length ?? 0);
      const end = start + m[0].length;
      ranges.push(hide.range(start, open + 2));
      if (m[2]) ranges.push(hide.range(targetEnd, targetEnd + 1), hide.range(open + 2, targetEnd));
      ranges.push(hide.range(end - 2, end));
    }
  }
  return Decoration.set(ranges, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = livePreview(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = livePreview(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        const box = e.target as HTMLElement | null;
        if (!box || !box.classList.contains('cm-task')) return false;
        e.preventDefault();
        const pos = view.posAtDOM(box);
        const line = view.state.doc.lineAt(pos);
        const m = /^(\s*[-*+]\s+\[)([ xX])\]/.exec(line.text);
        if (!m) return false;
        const at = line.from + (m[1]?.length ?? 0);
        view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' } });
        return true;
      },
    },
  },
);

const modeCompartment = new Compartment();

function modeExtensions(mode: EditorMode, hideFrontMatter: boolean): Extension[] {
  if (mode === 'source') return [Prec.highest(sourceTheme), plainFrontMatter];
  return [livePreviewPlugin, hideFrontMatter ? hiddenFrontMatter : plainFrontMatter];
}

// ---- editor -------------------------------------------------------------------------------------

export interface EditorOptions {
  ytext: Y.Text;
  undoManager: Y.UndoManager;
  mode?: EditorMode;
  /** Live mode: hide the YAML front matter (the Properties table shows it). */
  hideFrontMatter?: boolean;
  /** Open (or create) the note a `[[link]]` points to. */
  onOpenLink(target: string): void;
  /** A reason a `[[link]]` does not open (shown as its title, and a click leaves it alone); undefined when it opens. */
  linkTitle?(target: string): string | undefined;
  /** Tag clicked: search for it. */
  onTag?(tag: string): void;
  /** Create a task note for a checkbox line; returns the name to link, or null. */
  onMakeTask?(title: string, done: boolean): string | null;
  /** Attached files (paste, drop, embeds). Without it the editor shows `![[x.png]]` as plain text. */
  files?: AttachmentHost;
  /** Notices and refusals from adding files. */
  onFileMessages?(m: { notices: string[]; errors: string[] }): void;
}

function openLinkAtCursor(view: EditorView, open: (t: string) => void): boolean {
  const link = linkAt(view.state.doc.toString(), view.state.selection.main.head);
  if (!link || !link.target) return false;
  open(link.target);
  return true;
}

export function editorExtensions(o: EditorOptions): Extension[] {
  return [
    // Shortcuts as in Obsidian and VS Code; the list people see is SHORTCUTS in editor-commands.ts.
    // Ours come first, so Mod-i is italic rather than CodeMirror's "select parent syntax".
    keymap.of([
      ...yUndoManagerKeymap,
      { key: 'Mod-Enter', run: (v) => openLinkAtCursor(v, o.onOpenLink) || toggleTask(v) },
      ...(o.onMakeTask ? [{ key: 'Mod-Shift-Enter', run: makeTask(o.onMakeTask) }] : []),
      { key: 'Mod-b', run: toggleWrap('**') },
      { key: 'Mod-i', run: toggleWrap('*') },
      { key: 'Mod-Shift-x', run: toggleWrap('~~') },
      { key: 'Mod-`', run: toggleWrap('`') },
      { key: 'Mod-k', run: wrapLink },
      { key: 'Mod-l', run: cycleList },
      { key: 'Mod-.', run: cycleList },
      ...[0, 1, 2, 3, 4, 5, 6].map((n) => ({ key: `Mod-Alt-${n}`, run: setHeading(n) })),
      { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
      { key: 'Mod-Shift-l', run: selectSelectionMatches },
      ...defaultKeymap,
    ]),
    // Several cursors: Alt+click adds one (Ctrl+click opens links), Ctrl+Alt+Up/Down and Ctrl+D too.
    EditorState.allowMultipleSelections.of(true),
    EditorView.clickAddsSelectionRange.of((e) => e.altKey),
    drawSelection(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(highlight),
    baseTheme,
    modeCompartment.of(modeExtensions(o.mode ?? 'live', o.hideFrontMatter ?? true)),
    decoratorPlugin(wikiDecorator(o.linkTitle)),
    decoratorPlugin(tagDecorator),
    EditorView.contentAttributes.of({ 'aria-label': 'Note text', 'aria-multiline': 'true', spellcheck: 'true' }),
    ...(o.files ? [fileConfig.of({ host: o.files, onMessages: o.onFileMessages })] : []),
    EditorView.domEventHandlers({
      paste(e, view) {
        const data = e.clipboardData;
        if (!o.files || !data || data.files.length === 0 || data.types.includes('text/plain')) return false;
        e.preventDefault();
        void addFilesToEditor(view, Array.from(data.files));
        return true;
      },
      drop(e, view) {
        const files = e.dataTransfer?.files;
        if (!o.files || !files || files.length === 0) return false;
        e.preventDefault();
        void addFilesToEditor(view, Array.from(files), view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined);
        return true;
      },
      mousedown(e, view) {
        const target = e.target as HTMLElement | null;
        if (e.button !== 0 || !target) return false;
        const tagEl = target.closest('.cm-hashtag');
        if (tagEl && o.onTag && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          o.onTag((tagEl.textContent ?? '').replace(/^#/, ''));
          return true;
        }
        const el = target.closest('.cm-wikilink');
        if (!el || el.classList.contains('cm-wikilink-inert')) return false;
        const pos = view.posAtDOM(el);
        // Like Obsidian: a click opens the link, unless the cursor is already on that line
        // (then the click places the cursor to edit it). Ctrl/Cmd-click always opens.
        const sameLine = view.state.doc.lineAt(pos).number === view.state.doc.lineAt(view.state.selection.main.head).number;
        if (sameLine && view.hasFocus && !(e.ctrlKey || e.metaKey)) return false;
        const link = linkAt(view.state.doc.toString(), pos + 1);
        if (!link || !link.target) return false;
        e.preventDefault();
        o.onOpenLink(link.target);
        return true;
      },
    }),
    yCollab(o.ytext, null, { undoManager: o.undoManager }),
  ];
}

/** Switch between Live and Source mode, or show or hide the front matter, without remounting. */
export function setEditorMode(view: EditorView, mode: EditorMode, hideFrontMatter: boolean): void {
  view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode, hideFrontMatter)) });
}

/** Put the cursor at `pos`, scroll it to the top of the editor and focus it. */
export function revealOffset(view: EditorView, pos: number): void {
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 8 }) });
  view.focus();
}

/** Mount the editor in a shadow root of `host` (see the CSP note above). */
export function createEditor(host: HTMLElement, o: EditorOptions): EditorView {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.replaceChildren();
  const view = new EditorView({ root: shadow, state: EditorState.create({ doc: o.ytext.toString(), extensions: editorExtensions(o) }) });
  shadow.appendChild(view.dom);
  return view;
}
