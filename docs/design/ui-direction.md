# UI direction: what is left

Issue #33 (the design review of 2026-10-28).
Built: the restyle (tokens in `tokens.css`, `../decisions/theme.md` F-33e to F-33z), the shell and header timer (`../decisions/header-timer.md`, `../decisions/app.md` F-33c to F-33o), Settings as one page (`../decisions/settings.md` F-33, F-33zs), Home (F-33p) and the Tasks views (F-33v, F-33w).

## Left: slice 6, Tasks polish

- One view switch: List, Board, Table now. More views later, in the spirit of TaskNotes and Obsidian Bases; a trailing "+" is the place for them.
- Board: columns by status. Table: columns are the task fields (`../architecture.md`, tasks are notes).
- Filters stay behind one control.
- Screenshots at 1280 and 375 px, light and dark, in the PR; the `a11y` suite stays green.

## Principles that still apply

- One layout that changes only with width; no separate mobile interface, no bottom bar, drawers or sidebar.
- The timer is one click or one key away on every page while the Time feature is on.
- Keep Toggl's timer behaviour and Obsidian desktop's keyboard-first behaviour, not their looks (`../goals.md`).
- No new data, sync or storage; no migration (F39).
