# Day timeline: see gaps and overlaps

Design for #68; #114 (time-boxing) and calendar events are later layers, not built here.

## Goal

- See when in the day entries sit.
- Spot gaps (forgot a timer) and overlaps (two entries at once), and fix them on the spot.
- Works with sync off and offline; no new dependency (no calendar library), no change to stored entries.

## Layout

- A new **Calendar** segment on the Time page: List | Week | Calendar | Reports, at `#/time/calendar`.
- Day or Week inside it, with Previous, Next and Today; the last choice is kept like `timer-view`.
- Same component at every width (`ui-direction.md`): one column on phones, seven when there is room; a phone opens on Day.
- Hour axis over all 24 hours, scrolled on open to just before the first entry of the range (08:00 when empty).
- Blocks use the project colour and show the description, then the project when tall enough.
- Under the grid, **Gaps and overlaps**: the same findings as a plain list.

```text
          Mon 12        Tue 13
08:00   ┌────────┐
        │ Task A │    ┌────────┐
09:00   │ Proj 1 │    │ Task C │
        └────────┘    │ Proj 2 │
10:00   ┆ 50 min ┆    └──┬─────┤      ┆ ┆  gap: dashed, labelled, click to add
        ┆  gap   ┆    ▒▒▒│Task │      ▒▒▒  overlap: hatched, click to fix
11:00   ┌────────┐    ▒▒▒│  D  │
        │ Task B │    ┌──┴─────┤
12:00   └────────┘    │ running│      running: open lower edge, grows with the clock
```

## Rules

| Topic | Rule | Why |
| --- | --- | --- |
| Overlap | Two entries sharing at least 1 minute, by real time | Shorter ones come from the sync chain (`time.md`: accepted short overlap) and are noise |
| Gap | At least 15 minutes empty between the first entry's start and the last entry's stop of a local day; never after now | Needs no setting, no false alarms on days off; time before the first entry is still visible as empty grid |
| Which entries | The spaces the filter shows; running entries end at now | Same filter as every Time view. A filter to one space hides overlaps with other spaces, and the list says so |
| Midnight | Blocks are cut at local midnight; day totals here follow Reports (R4) | The List still counts an entry on its start day (F10), so its day total can differ for an entry over midnight |
| Range | Entries touching the range, not only starting in it | `entriesInRange` would drop the morning part of last night's entry |
| Week start | From `settings.week_start` | As in Week |
| Color | Never the only signal: hatch, dashes and text labels too | Accessibility, and project colours can clash |

### Daylight saving

- Findings and durations use real time; the drawing uses the wall clock, so a week's columns stay aligned.
- 25-hour day: the repeated hour draws on one row, so lanes are worked out from the drawn position, and a real overlap is still decided by real time.
- 23-hour day: the skipped hour is blank and is not a gap.
- Dragging within a repeated hour may land on either occurrence, so the entry editor stays the exact way to set it.
- Tested in Berlin and New York, like Reports.

## Actions

| On | Does | Reuses |
| --- | --- | --- |
| Block | Opens the entry editor | `EntryEditPanel` |
| Gap | Add entry with the times filled in; also "Extend previous" and "Start next earlier" | `ManualEntryDialog` (new initial times), `editEntry` |
| Overlap | Trim the first to end where the second starts, or the second to start where the first ends | `editEntry` |
| Overlap, one entry inside the other | Split the outer one around the inner one, or edit | `splitEntry` |
| Block edge | Drag to adjust start or stop, snapping to 5 minutes; Esc cancels | `editEntry` on release |

- Each edit is one transaction in the entry's own space (`all.slices`), with an Undo toast.
- A running entry's stop has no handle.
- Phones: tap a block to show its handles, so a swipe on the grid still scrolls.
- Dragging is only a shortcut: the editor does the same, so keyboard and screen-reader users lose nothing.
- Blocks are buttons in time order, labelled with times, project and any finding; the list under the grid has every action as a button.

## Code

- `src/time/timeline.ts`: pure and unit-tested: cut by day, `findOverlaps`, `findGaps`, lanes, time to position and back.
- `src/time/TimelineView.tsx`: lazy loaded; drag with pointer events, feature-detected, without them the editor still works.
- `splitByDay` is in `src/reports/dates.ts` and modules may not import each other: move it to `src/core`, with Reports importing it from there.
- The grid draws a list of blocks, so a later layer only adds blocks:

```ts
interface TimelineBlock {
  id: string;
  layer: 'entries' | 'events' | 'planned';
  start: number;
  end: number;
  title: string;
  color: string | null;
  editable: boolean;
}
```

- Only the `entries` layer counts toward gaps and overlaps.
- Later layers bring their own storage: `planned` a Yjs collection (fresh UUIDs, soft deletes); `events` from an `.ics` import or an opt-in subscription, listed in `docs/user/privacy.md`.

## Slices

One PR each, all `Refs #68` until the last.

1. Read only: grid, Day and Week, blocks, highlights, the list, moving `splitByDay`.
2. Fixes: gap and overlap actions, block opens the editor.
3. Drag block edges.

## Out of scope

- Moving a whole block by dragging, or drawing a new one.
- Calendar events, `.ics` import and export, planned blocks (#114).
