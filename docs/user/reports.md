# Reports

**Reports** is the third view of the Time page, next to **List** and **Week**. It adds up your entries by project, client, tag or day for a range you pick.

- Choose the range and what to group by (and then by).
- Hours show as decimals or `H:MM`; change it under **Settings › Display**, together with the first day of the week.
- Rates you set on a project give amounts for billable entries.
- Reports read only this device's data, so they work offline.
- **Previous** and **Next** move to the period before or after: a day, week, month or year by itself, a custom range by its own length. **Next** is off while the period includes today.
- The space menu at the top is the same one as on List and Week.
- The page remembers its range on this device. When it is not **This week**, the dates are highlighted and **This week ×** takes you back.
- **Table | Timesheet** switches the layout for weekly billing. The Timesheet is an invoice-style list with a block per project (or client, when you group by client) and a row for every day of the range, using the same range and filters.
  - Each day is rounded to the nearest 0.1 h, always in decimals. A block's total and the total for the period add the rounded days.
  - A day's note is its descriptions, once each, in the order you started them, joined with `; `.
  - Empty days are listed too, dimmed and without buttons, so you can paste day by day without losing your place.
  - Click the hours to copy them. **Copy description** copies the note and **Copy description and date** copies `date - note` (no weekday, no hours). **Copy all** copies the block's lines as `date - note`, a tab, hours. Days that round to 0.0 are dimmed and left out.
  - The layout is remembered on this device.

## Known limits

- In `H:MM`, each figure is rounded to the minute on its own, so rows may differ from the total by a minute.
- Grouping by tag can add up to more than the total, because an entry can have several tags and counts under each.
- An entry that runs past midnight sits on its start day in the Time list, but Reports split it at midnight and count each part on its own day.
