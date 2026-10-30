# Backup and restore

Yak keeps three kinds of safety net: Backups, Version history and Recently deleted.
They differ in what they cover, where they are stored, and what restoring from them does.
Every undo belongs to exactly one of them.

| Layer | Recently deleted | Version history | Backups |
| --- | --- | --- | --- |
| Like | A trash can | Version history in a document editor | An external drive |
| What it is | Something you deleted, marked as deleted | A log of every change | Full copies of your data |
| Stored | Inside your data, so it syncs with it | In a separate database in this browser | In a folder outside the browser, or a download |
| Synced | Yes, with your data | Not yet: each device records its own | No: they are your files |
| Restore covers | One item | Time entries, notes and tasks | Everything |

Nothing destructive happens without a way back: every action that replaces something keeps what it replaces.

## Backups

A browser can lose its data: a cleared profile, a company policy, a failing disk.
Backups copy everything to a folder you choose, ideally one that is itself backed up (OneDrive, Dropbox, a network drive).
They cover everything: entries, notes and tasks, projects, clients, tags, settings and the files in your notes.

### Set up

1. Open **Settings › Backups**, open **Where backups go, encryption, restore**, and press **Choose folder…**. Pick or create an empty folder.
2. The first backup is written straight away.
3. If the browser asks whether the app may keep access, choose **Allow on every visit**.

Folder backups need Chrome or Edge.
In Firefox and Safari use **Download backup (zip, with files)** regularly; it saves one `.zip` file with your data and the files in your notes.
**Download backup (JSON, without files)** saves a small text file and leaves the files out.

### When backups happen

- A few seconds after each stopped timer, and every hour while the app is open.
- When you press **Back up now**, which also makes a restore point.

A banner appears, and the **Settings** tab gets an amber **!** badge, when the last backup is too old or failed, or when the browser needs permission again. The sync button in the header lists the reason under **Other**.

### Several devices

You do not need to back up every space on every device.
When your devices sync, a recent backup made by another device counts for this one if it holds everything this device holds.
**Settings › Backups** then says **Backed up by** that device and when, and no warning appears.
If you change something here that no recent backup holds yet, nothing happens at first: open the device that backs up (so it syncs and backs up), or download a backup.
Once the backup is older than the limit you chose, the warning names that device.
Only spaces a device keeps are affected, and a device that never syncs warns exactly as before.

### Restore from a backup

In **Settings › Backups** choose a backup from the list, **Restore from a backup file…** (a `.zip` or `.json`) or **Restore from a folder…**.
Every file's checksum is checked first, and you see what the backup holds before anything changes.
A damaged backup is shown with its problems and cannot be restored; pick an older one.

- **Merge into this device** adds what is missing and keeps everything else, including later edits. It is the safe choice, also on a new browser.
- **Replace local data…** makes this device exactly like the backup. Everything made after the backup is removed from this device.
- **Restore to a time…** rebuilds your data as it was at a moment you pick, then shows it like any backup.

Replace keeps what it replaces:

- If a backup folder is set up, a backup of your current data is written to it first.
- The current data also stays on this device.
- The confirmation names both and the way back.

To undo a Replace, press **Merge it back** in **Settings › Backups**.
It stays visible for 45 days or until you dismiss it, and adds back everything the Replace removed.
Dismissing it hides the prompt only; the earlier data stays on the device.
The folder backup written before the Replace stays in the folder.

With sync on, Replace changes only this device.
Your other devices send their data back when they connect, so you may see the removed items return.

### Encrypted backups

Set a passphrase (the **Passphrase** line on **Settings**, or the sheet that opens when Yak needs it) for a folder others can read, then tick **Write only encrypted backups** in **Settings › Backups**. It covers the files in your notes too.
**If you forget the passphrase, nobody can open those backups.**

The folder layout is documented for developers in `docs/backups.md`.

Before you erase a device (**Settings › Advanced › Erase everything on this device**), save the zip backup it offers: it holds your files too. Restore it in **Settings › Backups**. See Devices and sync.

## Version history

Earlier versions of your time entries, notes and tasks.
Yak records every change in a log kept in a separate database in this browser.
For now each device records its own, so the list shows versions recorded on this device, and it cannot see further back than when this device started recording.
Every point says where it was recorded: **Recorded on: This device**.

In **Settings › Version history**, **Go back in time** lists days with changes, then the points of a day.
Choose a point to see what changed or was deleted since, tick what you want back, and press **Restore selected**.

- Old values come back as new edits. Later work stays; nothing is rolled back.
- Before each restore, Yak marks the moment as **Before restore** in the list. To undo the restore, choose that point and restore from it.
- Old points are thinned: every change is kept for 60 days, then one per day for a year, then one per month. **Before restore** points are never thinned away.
- Projects, clients, tags and settings are not covered. An edit to one of them, such as a rename, cannot be undone here.

Each note also has its own **Version history** (one note's text) with named versions.
The log is not a backup: clearing this browser's site data erases it. Backups are what survive that.

## Recently deleted

When you delete an item it is only marked as deleted, so it can come back for 45 days.
The mark lives inside your data, so it syncs: a delete on one device reaches the others, and so does a restore.
Open **Recently deleted** on Notes or the Time page and press **Restore**.
After 45 days it is gone for good, though older backups and Version history may still hold a copy.
Deleted items of other kinds (projects, clients, tags) are not listed yet.
