# Import from Toggl

Everything happens in your browser. The file is never uploaded.
Back up first, then import. An import only adds records; it never changes or deletes existing ones.

## 1. Export from Toggl

1. In Toggl Track open **Reports › Detailed**, choose a date range (a year at a time works well).
2. **Export › Download CSV**. Use the CSV, not the PDF or Excel file.
3. Note the time zone of your Toggl account (Profile settings).

## 2. Import

1. Open **Settings** and choose **Import…** under the table, then choose the CSV file (or drop it on the box).
2. Check the preview: the space to import into, the time zone of the export, and the counts.
3. Press **Import**. You can cancel; what was added stays.

If the preview says start and end do not match the duration, the time zone is probably wrong. Change it in the preview.

## Good to know

- Projects, clients and tags are created when missing, and matched by name otherwise.
- Not imported: amounts and rates, task names, users, running timers.
- Importing the same file again, or an overlapping export, adds only the new entries.
- Use the same time zone each time for the same Toggl account.
- Import on one device and let it sync to the others. Importing on two devices before they sync adds entries twice.
- Dates must be `YYYY-MM-DD` (or `DD.MM.YYYY`); set Toggl to that format if rows are reported.

## Known limits

- A Toggl team export can hold identical entries from different people (same description, project and times). They collapse into one.
- Importing the same data again with a **different time zone** shifts every time, so the entries count as new and appear twice.
