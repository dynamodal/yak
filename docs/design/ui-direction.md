# UI direction: identity, one responsive shell, header timer, Home

Issue #33.
Status: agreed with the owner in a design review (2026-10-28, mockups reviewed in chat). Built so far: the tokens restyle, all-sans type, the Time rename and the header (slice 3a), the timer pill with its popover, the Time switch and the Time page without a bar (slice 3b), and Tasks without Notes with independent Features switches (slice 3c). The Home tab and the Settings rework are not built.
Settings has its own note: `settings-structure.md` (supersedes the proposal in #22).

## Problem

The owner finds the UI generic and the UX not right, without a clear picture of "right".
A review of the current screens found:

| # | Finding | Example |
| --- | --- | --- |
| 1 | Little identity | Native selects, default blue links, grey hairline cards; only the logo has character |
| 2 | An overloaded top bar | Four tabs, running timer, `⌘`, `?` and an unlabelled status dot (now: icon tabs, timer, command button, one labelled sync control) |
| 3 | Controls before content | Tasks shows four dropdowns and a view switch above the first task; Time shows a view switch, a space select and Select above the log |
| 4 | Repetition | Today and This week cards repeat the day headers; a space pill on every row |
| 5 | No landing page | Time is a log; Notes and Tasks open on empty panes |
| 6 | Settings is a form dump | See `settings-structure.md` |

## Goals and non-goals

- A calm, minimal look with its own character; light and dark.
- One layout that changes only with width.
  No separate mobile interface; touch needs only bigger targets (already `pointer: coarse`, T3).
- The timer is one click or one key away on every page, when the timer feature is on.
- Keep Toggl's timer behaviour and Obsidian desktop's keyboard-first behaviour, not their looks (`goals.md`).
- Not a goal: new data, sync or storage; no migration (F39).
- Not a goal: a bottom bar, drawers or a sidebar (owner: tabs stay at the top; no second interface on phones).
  A sidebar workspace (spaces as navigation) was sketched and set aside; it strains flat spaces.

## Visual identity

Warm neutrals (Paper), rounded corners (Soft), one muted sage accent, all in the system sans (owner, 2026-10-28: no serif anywhere, the wordmark included).
Ink (monochrome, sharp) was rejected as too harsh; Soft's indigo as too generic.

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#FAF7F2` | `#1A1917` |
| `--surface` | `#FFFFFF` | `#242220` |
| `--surface-2` | `#F3EEE6` | `#2D2A27` |
| `--text` | `#1F1D1A` | `#ECE8E1` |
| `--muted` (owner pick) | `#67625A` | `#B4AEA3` |
| `--border` | `#EAE4DA` | `#36322E` |
| `--accent` (start, selection, links, focus, running) | `#4A7563` (owner pick `#4F7A68`, see F-33f) | `#8FC4B2` |
| `--accent-tint` (running wash, 14% / 24% accent over `--bg`) | about `#E4E8E1` | about `#2D4039` |
| `--stop` (the stop button while running; `--stop-text` on it) | `#8E3A2B` (white) | `#E39583` (dark) |
| `--warn` / `--warn-wash` | `#8F5A14` (owner pick `#B5762A`, see F-33f) / `#F7EBD8` | `#E0AE6A` / `#3A2F1F` |
| `--danger` (raspberry, distinct from the rust stop) | `#B42340` | `#F07A8C` |
| `--ok` / `--info` | `#3B7547` / `#3A6EA5` | `#6FBF86` / `#7FB0E8` |

- Radii: controls 9 px (`--radius`), cards 14 px (`--radius-card`), pills, tabs and the view switch fully round.
- Type: the system sans (`--font-sans`) everywhere; headings semibold; tabular figures for the clock and totals.
  No web font: the CSP and the no-remote-code rule stand.
- Nav tabs are soft pills (current = `--surface-2` fill), done in CSS without markup changes.
- Project dot defaults (`palette.ts`, new projects only; existing projects keep their colour): light `#4F86C6 #D9902F #8E6FC4 #3FA58A`, then `#C4617A #6C8F4E #C9693F #6D7F94`.
  Owner's dark-mode swatches for the first four: `#7FB0E8 #EBA84A #B9A0E8 #5FC4A8` (a project colour is one stored hex, so only the light set is a default).
- Start is the accent; Stop is `--stop`, so the state reads at a glance, not only by icon.
- Icons: our own drawings in `icons.tsx` (the mockups used a webfont only to sketch).
- The restyle is tokens and `ui.css` first; a few module rules changed colour or radius only (time.css stop/running, card radii).

## Shell and navigation

Header, left to right on a wide screen: `[logo + app name]  [tabs]  ····  [timer pill]  [command button]  [sync status]`.
Only the pill changes width; the command and sync controls stay put to its right.

- Tabs at the top on every width: Home, Time, Notes, Tasks, Settings (Features hides Time, Notes, Tasks, each on its own; Home and Settings stay).
  Home is not built yet.
- The Timer tab is **Time**, at `#/time` (`#/time/list`, `#/time/week`, `#/time/reports[/<section>]`).
  Only the tab, route and wording changed; stored names stay (F39).
- Logo and the app name (`APP_NAME`) wide; the logo alone under about 440 px.
  The logo links to the first tab.
- Each tab has an icon and a label.
  Under about 560 px the labels go and the icons stay (the names stay as hidden text).
  Below 64 rem the tabs take a second row.
- Command palette button: the command icon and a chip with the bound shortcut (default `Alt+P`, written as the Shortcuts card does; symbols on a Mac).
  Icon only under about 560 px and on touch.
  Name "Command palette", tooltip "Search, go to, run a command".
- Sync status: a bordered button with a chevron (so it reads as clickable; icon only on narrow screens) that opens a popover.
  Shape as well as colour, never colour alone:

  | Shape | Colour | Meaning |
  | --- | --- | --- |
  | Square | grey | Sync is off, or on but no other device is paired yet. The popover offers "Set up sync". |
  | Filled circle | accent | Paired and linked to at least one device directly. |
  | Ring | accent | Linked, but only through the relay (sealed data, slower). |
  | Triangle | amber | Paired, and no device is linked now. |

  The popover lists each device with its link (Direct, Via relay, Connecting, Not connected) and when it was last connected, a note about the relay, and a link to Settings.
  What other modules report as health (a stale backup) is listed under "Other" there.
- Help (`?`) and the data-status dot are gone from the header.
  Help is reachable from Settings (About & help), the palette ("Go to Help") and the welcome screen.
  A neutral dot on the Settings tab shows while What's new has unseen entries; it turns amber when a health report is a warning.
- Banners (No backup yet, backup outdated) stay below the header.
- Page headers carry the view switch and one primary action; filters collapse behind one "Filters" control until used (Tasks, Time).
- The space filter shows only when there is more than one space; space pills on rows likewise.

## Timer pill

Built (slice 3b; `decisions/header-timer.md` F-33j and F-33k, `decisions/app.md` F-33l).
The pill is the only timer control; the Time page is the log.

- Shown on every page while the Time feature is on (Features, per device).
  Off: no pill, no Time tab, no Alt+S, no cue (title, favicon, badge), and no timer button on tasks.
- Idle: `Start`, the bound shortcut as a chip (`Alt S`, symbols on a Mac) and a round accent play button.
  Under about 560 px the label goes and only the round button stays.
- Running: project dot, description (ellipsis, "(no description)"), elapsed time (tabular) and a round `--stop` button.
- Two hit areas: the round button starts or stops at once and never opens anything (a start with no description is valid; it uses the popover's draft, in the active space, on the current page); the label opens the popover.
- Popover (shared `Popover`, a labelled dialog): description, then Recent, then project, tags and billable; footer `Start` (`Update` while running). There is no Discard here: a running or stopped entry is deleted from the entries list (soft delete with Undo).
  Recent: first row `Continue: <description> · <project> · stopped <time ago>` (the entry that stopped last in any space), then up to 5 distinct recent combinations.
  Arrow keys move, Enter picks; stopped, a pick starts a new entry, running it fills the running one.
  `Enter` starts or updates, `Esc` closes; a half-typed description survives navigation.
- `Alt+S` stopped: starts at once and opens the popover with focus in the description; `Esc` keeps the timer running and returns focus.
  Running: it stops the timer and opens nothing.
  `Alt+T` is Go to Time; both stay as they are (owner, 2026-10-28), rebindable like every shortcut.
- Narrow: from 360 px the header is at most two rows: row one is the logo, the tab icons, the command and sync controls (and the idle round button); row two exists only while running and is the full-width pill (under 30 rem; wider windows keep the pill on row one). Below 360 px the tabs take their own row, so a running header has three.
- The Time page has no start bar; its page header has `Add entry` (the manual-entry form).
- Considered and rejected: a page bar that replaces the pill (Toggl's look, but the control moves), and both at once (two start buttons).

## Home

A summary of where things stand; read-only apart from checking a task off and opening things.

- First tab, and the landing page.
- Cards, each hidden when its feature is off or it has nothing to show:
  - Needs you: the same rows as Settings' "Needs you" (a join request, no backup).
  - This week: total and a bar per day.
  - Due soon: tasks, with late ones marked, checkable.
  - Recent notes.
  - Where the week went: a bar by project.
- Cards reflow by width: three across, then two, then one.
- Open: whether Home hides for a Time-tracker-only preset (then Time is the landing page).

## Tasks views

- Tasks work without Notes (F-33n): with Notes off a task opens at `#/tasks/<id>` in the same editor; `[[links]]` to other tasks open them, links to plain notes are inert ("Turn on Notes to open this note"); the Table lists tasks only.
  Notes off also hides the Notes tab, the tree, plain-note search results, daily notes and the notes commands.

- One view switch: List, Board, Table now.
  More views later, in the spirit of TaskNotes and Obsidian Bases; a trailing "+" is the place for them (not built now).
- Board: columns by status.
  Table: Task, Status, Due, Project, Tracked; columns are the task fields (`architecture.md`, tasks are notes).
- Rows show tracked time when the timer feature is on.
- Filters sit behind one control, not four dropdowns.

## Slices (one PR each, `Refs #33`)

1. Fix `scripts/screens.mjs` (test build, Welcome step, current routes) so restyle PRs can show before and after.
2. Tokens restyle (`tokens.css`, `ui.css`).
3. Shell, in parts: (a) header, all-sans, Time rename and route (built); (b) timer pill and popover, Time page without its bar, Time switch (built); (c) Tasks without Notes and independent Features switches (built).
4. Settings (`settings-structure.md`).
5. Home.
6. Tasks view switch and filters.

Screenshots at 1280 and 375 px, light and dark, in every PR; `a11y` suite green.
