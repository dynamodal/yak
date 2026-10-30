# Timer page: decisions and open questions

The aim is the Toggl Track desktop app's way of working, including its narrow "mini" window, without its look or wording.
Presentation and interaction only: no change to the data model, to the `entries.ts` or `catalog.ts` signatures, or to how spaces are listed.

## What the review of the old page found

- Every row was a card with three text buttons (Continue, Edit, Delete) under it: about 80 px per entry, and the same actions repeated twenty times on screen.
- The bar put the clock and Start/Stop on a second line under the fields, and "Add manual entry" was a separate button and form below it.
- Today and "This week" were separate lists with different headings, so yesterday looked like a sub-heading of the week.
- Repeated work (three "Dependency review" blocks in one afternoon) took three full cards.
- In a 360 × 560 window the list did not start until below the fold; the bar alone took 250 px.
- Nothing scrolled sideways at 375 px, but rows wrapped into four lines.

## Decisions

| # | Decision | Why | How to change it |
| --- | --- | --- | --- |
| X1 | One bar: description, project, tags, billable, a clock button for adding a finished entry, and a pill button showing `0:00:00` and play (stopped) or the elapsed time and stop (running). One row on wide screens; description and start/stop first, fields underneath, at 40 rem and below | T1 and T2; the elapsed time sits in the button as asked, so the eye goes to one place | `TimerBar` in `TimerView.tsx`, `.tb` in `time.css` |
| X2 | When the running entry is in the page's space, the bar shows and edits it. When it runs in another space, a line above the bar says "Running in Work: description" with its clock and Stop, and the bar stays free to start something here (which stops it) | One running timer across spaces; "start here" from another space is existing, tested behaviour (`header-timer.mjs`) | `TimerBar` in `TimerView.tsx` |
| X3 | The project picker is a searchable list grouped by space, then client. When stopped it offers every space this device keeps; the entry is created in the chosen project's space. Without a project, the page's space | `sync-model.md` point 6. "Default: last used" space is not built: there is no model field for it | `ProjectPicker` in `pickers.tsx`; `spaceId` in `TimerBar` |
| X4 | While running, and on existing rows, the picker offers only the entry's own space | Moving an entry to another space means moving it between documents, a model change | Ask for a `moveEntry` model function if wanted |
| X5 | The space shows on the bar's project button only when it is not the page's space; the list always has space headings when there are two or more spaces | Keeps the button short in a mini window | `showSpace` in `TimerBar` |
| X6 | Tags: a picker with a checklist and "type and press Enter" to add. Tag names picked for a project in another space get a tag record in that space when the entry is created | Tags are per space (`sync-model.md` point 1) | `TagPicker`, `tagsFor` in `TimerView.tsx` |
| X7 | Billable is a coin icon toggle (a hidden checkbox), green when on | T4; our own icon, not a dollar sign | `.tb-billable` |
| X8 | "Add manual entry" is now a mode of the bar (the clock button): date, from and to times, Add. A "to" time at or before "from" means the next day | T15 and T9; one place to enter work | `manualRange` in `TimerView.tsx` |
| X9 | The list shows the last 7 days, newest first, each day a card with its total; "Show earlier days" adds 7 more. Today's and this week's totals sit in one line above | T5; Toggl's list is a continuous history, not "today" and "this week" | `PAGE_DAYS` in `TimerView.tsx` |
| X10 | The running entry is not a row in the list (it is in the bar); day totals still count it | As in the desktop app; avoids two live clocks on one screen | `hideRunning` on `DayList` |
| X11 | Repeated entries of a day (same description ignoring case and spacing, project, tags in any order, billable) collapse into one row with a count, the time span and the sum; the count expands them. On the Timer page's List view only; the Week view lists every entry | T6 and U2's proposed default; the Entries page stays the place to see each entry | `groupRepeats` in `grouping.ts`; `group` on `DayList` |
| X12 | Row: description, project, tags, billable mark; times and duration on the right; continue (play) and "…" on hover or keyboard focus, always visible on touch screens (`hover: none`). In a narrow window with a mouse, the actions float over the end of the row instead of taking room from the description | T7 | `.te-actions` in `time.css` |
| X13 | "…" menu: Edit, Duplicate, Delete. Delete acts at once and shows a toast with Undo (8 seconds). For 45 days after, "Recently deleted" at the bottom of the Timer page lists the entry with Restore; after that the delete is permanent. Deletes stamp `deleted_at`; a restore clears it and the entry comes back stopped | Q4. The limit keeps the design plan's rule that deletes end up permanent (and safe for a later compaction); the window is one constant, so Q8 is a one-line change | `deleteEntry`, `restoreEntry`, `recentlyDeleted`, `RESTORE_WINDOW_DAYS` in `entries.ts`; `RecentlyDeleted` in `entry-ui.tsx` |
| X14 | Inline edits: click the description, the project or the duration to edit just that; Enter or leaving the field saves, Escape cancels. A click anywhere else on the row opens the full editor (fields, start and stop, split) | T8 | `InlineEdit`, `EntryRow` |
| X15 | Durations accept `1:30`, `1:30:15`, `90m`, `1.5h`, `1,5 h`, `1h 30m`, `2h15`, `45s`; a plain whole number is minutes and a plain decimal number is hours. Editing a stopped entry's duration moves its stop; a running one's moves its start | T9 | `parseDuration` in `duration.ts` |
| X16 | The page heading "Timer" is visually hidden (still read by screen readers) | The active tab already says Timer; 50 px back in a mini window | `.visually-hidden` on the `h1` |
| X17 | The header timer stays on the Timer page, sticky at the top | It is what keeps the running entry and Stop visible after scrolling a long list in a mini window, and `header-timer.mjs` relies on it; see Q2 | `decisions/header-timer.md` H2 |
| X18 | Colours, icons and wording are our own: tokens only (no new colours), icons from `src/app/ui/icons.tsx`, own phrases ("What are you working on?", "Add a finished entry", "Show earlier days") | "Borrow behaviour, not identity" | — |
| X19 | Timer and Entries list every space this device keeps, each row labelled with its space when more than one is kept; a "Show space" filter (remembered on this device) narrows them. Rows edit the space their entry lives in. The header has no space dropdown | Owner review B9, Q1; a space is the sync boundary, not the display boundary | `useAllTime`, `RowSpaces` in `entry-ui.tsx`, `SpaceFilter` |
| X20 | New entries go to the last used space (the project's space when a project is chosen); a small "Space for the new entry" picker shows when no project is chosen and more than one space is kept | Q7 answer (2026-10-17) | `TimerBar`; `setSpaceId` is called on start |
| X21 | Projects show one space at a time, with a space picker at the top; Reports default to all spaces. Notes and Tasks can also show all spaces (N24) | A per-page picker was the simpler first step | `SpacePicker` |
| X22 | Header: "Continue: <entry>" is a labelled play button; clicking the status area (running entry or "Not tracking") opens a switcher with recent work, projects, "Start a new timer" and "Open the Timer page" | B6, B7; as on the Toggl desktop app (T16) | `Switcher` in `HeaderTimer.tsx` |
| X23 | Projects, clients and tags can be made from the timer bar: type a name in the project picker and choose "Create project", or type "Client / Project" to make both; a new tag is added in the tag picker | Owner request (2026-10-17) | `ProjectPicker` in `pickers.tsx` |
| X24 | The Timer page has a List \| Week switch in its header (`#/timer/list`, `#/timer/week`). List is the 7-day list (X9, X11). Week is the former Entries page: week controls, every entry separate, empty days shown, week total, the running entry as a row. The timer bar stays at the top in both; `#/timer` opens the last used view, remembered on this device. `#/entries` redirects to Week | Entries repeated the Timer list in a week frame; one fewer tab (#134, owner, 2026-10-18) | `WeekEntries` in `EntriesView.tsx`, `MODE_KEY` in `TimerView.tsx` |
| X26 | **Projects and clients are a list; a click opens the row's fields, Done closes them (#135).** The line shows swatch, name, client, space, Archived and "Billable · 80 USD/h"; the "…" menu has Edit, Archive or Restore, and Delete (with the move-first panel). A new project or client opens its fields at once. One row is open at a time; fields save on change as before. Tags already had their actions in "…" (rename or merge, hide, remove) | Eight always-open form fields per row made the page a form; the facts that matter are readable at a glance, as on the Timer rows (X14) | `ProjectRow`, `ClientRow`, `editing` in `ProjectsView.tsx` |
| X25 | Today's and this week's totals are two large figures under the bar (cards, `--text-2xl`); each day's total lines up with the row durations: the day header's right padding equals the actions column (`--te-actions-w`), which differs for touch (`hover: none`) and for the floating actions of a narrow window with a mouse | #135: the numbers the page is for get the most weight; a day total in the margin made sums hard to check against the rows | `.tl-summary`, `.tl-stat`, `.day-head` in `time.css` |
| X27 | **Phones edit an entry in a bottom sheet (#150; amends X14).** On a narrow touch screen (`(max-width: 40rem) and (pointer: coarse)`) a tap anywhere on a row opens the full editor in a `Sheet`; the row has no inline edits. Wide screens and narrow windows with a mouse keep X14. The sheet is a modal `<dialog>` (focus stays inside, Escape closes) and also closes on a backdrop tap, the Close button or a swipe down on its handle | Inline fields were small tap targets and an expanded editor pushed the list around; one behaviour on phones (owner, 2026-10-19) | `Sheet`, `SHEET_MEDIA` in `src/app/ui/Sheet.tsx`; `phone` in `EntryRow` |
| X-106 | **Suggestions are one opaque list over the details popover (#106; amends #60):** each row is the description, then project, tags and space on a second line; while the list is open the popover's recent list is hidden (`visibility`, so nothing moves) | The recent rows showed through and overlapped the floating list, a box inside a box | `DescriptionField` in `widgets.tsx`, `.combo-opt` and `.tp-form:has(.combo-list)` in `time.css` |

## Owner answers (2026-10-16)

| # | Question | Answer | Status |
| --- | --- | --- | --- |
| Q1 | Should the Timer page list entries of every space this device keeps, each row labelled with its space? | Yes | Next, on its own branch now that the account layout (#39) has landed |
| Q2 | Compact the shell in a mini window: the header on one row under 40 rem (app name hidden, sync chip as a dot) and the backup reminder dismissible for a day? Today it takes about 300 px before the timer bar | Yes | Next, on its own branch (shell code in `App.tsx`) |
| Q3 | Hide the header timer on the Timer page (H2 in `header-timer.md`) now that the bar shows the same thing? | Not sure | Check after testing live; for now it stays (X17) |
| Q4 | Delete with Undo (U1) needs the model to allow restoring a deleted entry | Yes, and restorable for a day, not only seconds (later 45 days, Q8) | Built: X13 |
| Q5 | A setting to turn grouping (X11) off (U2)? | Not now | — |
| Q6 | `@` and `#` in the description to pick a project and tags (T3), and keyboard shortcuts (T13) | Later | — |
| Q7 | Without a project, which space does a new entry go to: the page's space (built) or the last used one? | Confirm later | Page's space for now |
| Q8 | Keep deleted entries restorable for 45 days instead of 1, to cover a monthly timesheet? | Yes (owner, 2026-10-16) | `RESTORE_WINDOW_DAYS` in `src/time/entries.ts` |

## Browser assumptions and fallbacks

- `@media (hover: none)` decides whether row actions are always visible; a touch laptop with a mouse reports `hover: hover` and gets the hover behaviour, and keyboard focus inside a row shows the actions too.
- `<input type="date">` and `<input type="time">` show the browser's own pickers and use the system's 12- or 24-hour format.
- Popovers are positioned with `element.style` (allowed by the CSP); nothing uses inline `<style>` or `style=""`.

## Tests

- `src/time/duration.test.ts`: the duration parser and repeat grouping.
- `src/time/entries.test.ts`: restore within the window and not after, the deleted list, and two devices converging when one restores while the other edits the deleted entry.
- `scripts/e2e/time.mjs` (66 checks): picker by keyboard, billable from the project, tag creation, hover reveal, inline description, duration (valid and refused) and project edits, the full editor on a row click, split into a group with a count and sum, expand and collapse, continue from a group, finished entries from the bar, duplicate, delete, Undo and Restore, projects from another space labelled and the entry created there, the Entries page, tag rename; 375 × 800 and 360 × 560 with no horizontal scroll on Timer, Entries and Projects, the bar's Stop on screen, description and Stop on one row, the header's Stop still on screen after scrolling; touch emulation with actions always visible and the row opening the bottom sheet (tap, edit, Escape, backdrop and swipe to close).
