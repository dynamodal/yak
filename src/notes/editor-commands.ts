import { EditorSelection, type ChangeSpec, type EditorState, type StateCommand } from '@codemirror/state';

/**
 * Markdown editing commands for the note editor's shortcuts (docs/decisions/notes-editor.md).
 * Plain state commands, so they are unit tested without a DOM. Each works on every selection
 * range, so they also work with several cursors.
 */

/** The word around a cursor (letters, digits, `_`, `-`), or an empty range at the cursor. */
function wordAt(state: EditorState, pos: number): { from: number; to: number } {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  let a = pos - line.from;
  let b = a;
  const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_-]/u.test(c);
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  return { from: line.from + a, to: line.from + b };
}

/**
 * Wrap the selection (or the word at the cursor) in `mark`, or unwrap it when it is already
 * wrapped: bold `**`, italic `*`, strikethrough `~~`, inline code `` ` ``.
 */
export function toggleWrap(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const n = mark.length;
    const tr = state.changeByRange((range) => {
      let { from, to } = range.empty ? wordAt(state, range.from) : range;
      const before = state.sliceDoc(from - n, from);
      const after = state.sliceDoc(to, to + n);
      const inside = state.sliceDoc(from, to);
      // Unwrap `**x**` when the marks are just outside the selection, or part of it.
      const partOfBold = mark === '*' && state.sliceDoc(from - 2, from) === '**' && state.sliceDoc(to, to + 2) === '**';
      if (before === mark && after === mark && !partOfBold) {
        return {
          changes: [
            { from: from - n, to: from, insert: '' },
            { from: to, to: to + n, insert: '' },
          ],
          range: EditorSelection.range(range.anchor - n, range.head - n),
        };
      }
      if (inside.length >= 2 * n && inside.startsWith(mark) && inside.endsWith(mark)) {
        return {
          changes: { from, to, insert: inside.slice(n, inside.length - n) },
          range: EditorSelection.range(from, to - 2 * n),
        };
      }
      if (from === to) {
        // Nothing to wrap: insert the pair and put the cursor between.
        return { changes: { from, insert: mark + mark }, range: EditorSelection.cursor(from + n) };
      }
      const changes: ChangeSpec[] = [
        { from, insert: mark },
        { from: to, insert: mark },
      ];
      from += n;
      to += n;
      return { changes, range: range.empty ? EditorSelection.cursor(range.head + n) : EditorSelection.range(from, to) };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

/** The lines touched by the selection ranges, each once. */
function selectedLines(state: EditorState): { from: number; text: string }[] {
  const seen = new Set<number>();
  const out: { from: number; text: string }[] = [];
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      out.push({ from: line.from, text: line.text });
    }
  }
  return out;
}

const LIST_PREFIX = /^(\s*)(?:([-*+])\s+(\[([ xX])\]\s+)?)?/;

/**
 * Cycle each selected line: text → `- ` bullet → `- [ ] ` task → `- [x] ` done → text.
 * Indentation is kept; a numbered line becomes a bullet.
 */
export const cycleList: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  for (const line of selectedLines(state)) {
    const numbered = /^(\s*)\d+[.)]\s+/.exec(line.text);
    const m = LIST_PREFIX.exec(line.text);
    const indent = (numbered ?? m)?.[1] ?? '';
    const prefixLen = numbered ? numbered[0].length : (m?.[0].length ?? 0);
    let next: string;
    if (numbered || !m?.[2]) next = '- ';
    else if (!m[3]) next = '- [ ] ';
    else if (m[4] === ' ') next = '- [x] ';
    else next = '';
    changes.push({ from: line.from + indent.length, to: line.from + prefixLen, insert: next });
  }
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input.format' }));
  return true;
};

/** Tick or untick the task on each selected line. Returns false when no selected line is a task. */
export const toggleTask: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  for (const line of selectedLines(state)) {
    const m = /^(\s*[-*+]\s+\[)([ xX])\]/.exec(line.text);
    if (!m) continue;
    const at = line.from + (m[1]?.length ?? 0);
    changes.push({ from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' });
  }
  if (changes.length === 0) return false;
  dispatch(state.update({ changes, userEvent: 'input.format' }));
  return true;
};

/**
 * "Make this a task": on a checkbox line, `make` creates a task note for the text and returns the
 * name to link; the text becomes `[[name]]`, the checkbox state stays. Returns false on any other line.
 */
export function makeTask(make: (title: string, done: boolean) => string | null): StateCommand {
  return ({ state, dispatch }) => {
    const line = state.doc.lineAt(state.selection.main.head);
    const m = /^(\s*[-*+]\s+\[([ xX])\]\s+)(.*\S)\s*$/.exec(line.text);
    if (!m || /^\[\[[^\]]*\]\]$/.test(m[3] as string)) return false;
    const name = make((m[3] as string).trim(), m[2] !== ' ');
    if (!name) return false;
    const from = line.from + (m[1] as string).length;
    dispatch(state.update({ changes: { from, to: line.to, insert: `[[${name}]]` }, userEvent: 'input.format' }));
    return true;
  };
}

/** Make each selected line a heading of `level` (1–6), or plain text with 0. Same level again removes it. */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const current = (t: string): number => /^(#{1,6})\s/.exec(t)?.[1]?.length ?? 0;
    const all = lines.every((l) => current(l.text) === level);
    const changes = lines.map((l) => {
      const m = /^#{1,6}\s+/.exec(l.text);
      const target = all ? 0 : level;
      return { from: l.from, to: l.from + (m?.[0].length ?? 0), insert: target > 0 ? `${'#'.repeat(target)} ` : '' };
    });
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

/** Wrap the selection (or the word at the cursor) in `[[ ]]`; with nothing to wrap, insert `[[]]` and put the cursor inside. */
export const wrapLink: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    const { from, to } = range.empty ? wordAt(state, range.from) : range;
    if (from === to) return { changes: { from, insert: '[[]]' }, range: EditorSelection.cursor(from + 2) };
    return {
      changes: [
        { from, insert: '[[' },
        { from: to, insert: ']]' },
      ],
      range: EditorSelection.cursor(to + 4),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
};

/** Cycle each selected line through heading 1 → 2 → 3 → plain text (the toolbar's heading button). */
export const cycleHeading: StateCommand = (target) => {
  const first = selectedLines(target.state)[0];
  const level = /^(#{1,6})\s/.exec(first?.text ?? '')?.[1]?.length ?? 0;
  return setHeading(level >= 3 || level === 0 ? (level === 0 ? 1 : 3) : level + 1)(target);
};

/** Make each selected line a plain bullet, or remove the bullet or task mark when it has one. */
export const toggleBullet: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  for (const line of selectedLines(state)) {
    const numbered = /^(\s*)\d+[.)]\s+/.exec(line.text);
    const m = LIST_PREFIX.exec(line.text);
    const indent = (numbered ?? m)?.[1] ?? '';
    const prefixLen = numbered ? numbered[0].length : (m?.[0].length ?? 0);
    changes.push({ from: line.from + indent.length, to: line.from + prefixLen, insert: !numbered && m?.[2] ? '' : '- ' });
  }
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input.format' }));
  return true;
};

/** Indent (`1`) or outdent (`-1`) each selected line by two spaces. */
export function indentLines(dir: 1 | -1): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = [];
    for (const line of selectedLines(state)) {
      if (dir > 0) changes.push({ from: line.from, insert: '  ' });
      else {
        const n = /^( {1,2}|\t)/.exec(line.text)?.[0].length ?? 0;
        if (n) changes.push({ from: line.from, to: line.from + n });
      }
    }
    dispatch(state.update({ changes, userEvent: 'input.format' }));
    return true;
  };
}

export interface Shortcut {
  keys: string;
  action: string;
}

/** The list shown in the note menu's "Keyboard shortcuts"; keep in step with the keymap in editor.ts. */
export const SHORTCUTS: readonly Shortcut[] = [
  { keys: 'Ctrl+B', action: 'Bold' },
  { keys: 'Ctrl+I', action: 'Italic' },
  { keys: 'Ctrl+Shift+X', action: 'Strikethrough' },
  { keys: 'Ctrl+`', action: 'Inline code' },
  { keys: 'Ctrl+K', action: 'Link: wrap in [[ ]]' },
  { keys: 'Ctrl+L or Ctrl+.', action: 'Cycle: text → bullet → task → done' },
  { keys: 'Ctrl+Shift+Enter', action: 'Make the checkbox line a task note' },
  { keys: 'Ctrl+Enter', action: 'Tick a task, or open the link under the cursor' },
  { keys: 'Ctrl+Alt+1 … 6, Ctrl+Alt+0', action: 'Heading 1–6, or plain text' },
  { keys: 'Tab / Shift+Tab', action: 'Indent / outdent' },
  { keys: 'Alt+↑ / Alt+↓', action: 'Move line up / down' },
  { keys: 'Shift+Alt+↑ / ↓', action: 'Copy line up / down' },
  { keys: 'Ctrl+Shift+K', action: 'Delete line' },
  { keys: 'Alt+click, Ctrl+Alt+↑ / ↓', action: 'Add a cursor' },
  { keys: 'Ctrl+D', action: 'Add the next occurrence to the selection' },
  { keys: 'Ctrl+Shift+L', action: 'Select every occurrence' },
  { keys: 'Esc', action: 'Back to one cursor' },
  { keys: 'Ctrl+Z / Ctrl+Shift+Z', action: 'Undo / redo (this device’s edits)' },
  { keys: 'Ctrl+O', action: 'Find a note (quick switcher)' },
];
