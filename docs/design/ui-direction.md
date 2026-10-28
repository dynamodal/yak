# UI direction: identity, one responsive shell, header timer, Home

Issue #33.
Status: agreed with the owner in a design review (2026-10-28, mockups reviewed in chat); not built.
Settings has its own note: `settings-structure.md` (supersedes the proposal in #22).

## Problem

The owner finds the UI generic and the UX not right, without a clear picture of "right".
A review of the current screens found:

| # | Finding | Example |
| --- | --- | --- |
| 1 | Little identity | Native selects, default blue links, grey hairline cards; only the logo has character |
| 2 | An overloaded top bar | Four tabs, running timer, `⌘`, `?` and an unlabelled status dot |
| 3 | Controls before content | Tasks shows four dropdowns and a view switch above the first task; Timer shows a view switch, a space select and Select above the log |
| 4 | Repetition | Today and This week cards repeat the day headers; a space pill on every row |
| 5 | No landing page | Timer is a log; Notes and Tasks open on empty panes |
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

Warm neutrals and a serif for headings and big numbers (Paper), rounded corners (Soft), one muted sage accent.
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
- Type: headings and big numbers (clock, totals) in `--font-serif` (`Georgia, 'Times New Roman', serif`); UI text stays the system sans; tabular figures for time.
  No web font: the CSP and the no-remote-code rule stand.
- Nav tabs are soft pills (current = `--surface-2` fill), done in CSS without markup changes.
- Project dot defaults (`palette.ts`, new projects only; existing projects keep their colour): light `#4F86C6 #D9902F #8E6FC4 #3FA58A`, then `#C4617A #6C8F4E #C9693F #6D7F94`.
  Owner's dark-mode swatches for the first four: `#7FB0E8 #EBA84A #B9A0E8 #5FC4A8` (a project colour is one stored hex, so only the light set is a default).
- Start is the accent; Stop is `--stop`, so the state reads at a glance, not only by icon.
- Icons: our own drawings in `icons.tsx` (the mockups used a webfont only to sketch).
- The restyle is tokens and `ui.css` first; a few module rules changed colour or radius only (time.css stop/running, card radii).

## Shell and navigation

- Tabs at the top on every width: Home, Timer, Notes, Tasks, Settings (Features hides Timer, Notes, Tasks; Home and Settings stay).
- Each tab has an icon and a label.
  Under about 560 px the labels go and the icons stay (with accessible names).
  Under about 440 px the logo text goes too.
- The header's right side holds the timer pill and search (`⌘K`, the palette), nothing else.
  Help (`?`) and the data-status dot move into Settings (the "Needs you" strip and status lines) and the palette; a "What's new" dot shows on the Settings tab.
- Page headers carry the view switch and one primary action; filters collapse behind one "Filters" control until used (Tasks, Timer).
- The space filter shows only when there is more than one space; space pills on rows likewise.

## Timer pill

The pill is the only timer control; the Timer page is the log.

- Shown on every page while the timer feature is on (Features, per device).
  Off: no pill, no Timer tab, no `Alt+T`, and tracked-time columns disappear from Tasks.
- Idle: `Start timer · Alt+T` with a round accent play button.
- Running: description (shortened), elapsed time, a round `--stop` stop button.
- Two hit areas: the round button starts or stops at once (a start with no description is valid and can be filled in afterwards); the label opens a popover.
- Popover: description, project, tags, billable, `Start` (`Update` while running) and `Discard`.
  `Enter` starts, `Esc` closes.
- `Alt+T` toggles the timer (a registered command, rebindable like every shortcut).
- Narrow: the description goes, time and button stay.
- Considered: a page bar that replaces the pill on the Timer page (Toggl's look, but the control moves) and both at once (two start buttons).
- The existing `registerHeaderItem` slot and header-timer decisions (`decisions/header-timer.md`) are the starting point; the Timer page's own start bar is removed.

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
- Open: whether Home hides for a Time-tracker-only preset (then Timer is the landing page).

## Tasks views

- One view switch: List, Board, Table now.
  More views later, in the spirit of TaskNotes and Obsidian Bases; a trailing "+" is the place for them (not built now).
- Board: columns by status.
  Table: Task, Status, Due, Project, Tracked; columns are the task fields (`architecture.md`, tasks are notes).
- Rows show tracked time when the timer feature is on.
- Filters sit behind one control, not four dropdowns.

## Slices (one PR each, `Refs #33`)

1. Fix `scripts/screens.mjs` (test build, Welcome step, current routes) so restyle PRs can show before and after.
2. Tokens restyle (`tokens.css`, `ui.css`).
3. Shell: icon tabs, responsive collapse, header pill and popover, Timer page without its bar.
4. Settings (`settings-structure.md`).
5. Home.
6. Tasks view switch and filters.

Screenshots at 1280 and 375 px, light and dark, in every PR; `a11y` suite green.
