# Backup and restore

A browser can lose its data: a cleared profile, a company policy, a failing disk.
Backups copy everything to a folder you choose, ideally one that is itself backed up (OneDrive, Dropbox, a network drive).

## Set up

1. Open **Settings › Backup and safety**, choose **Backup** to open **Backup & restore**, and press **Choose folder…**. Pick or create an empty folder.
2. The first backup is written straight away.
3. If the browser asks whether the app may keep access, choose **Allow on every visit**.

Folder backups need Chrome or Edge.
In Firefox and Safari use **Download backup (zip, with files)** regularly; it saves one `.zip` file with your data and the files in your notes.
**Download backup (JSON, without files)** saves a small text file and leaves the files out.

## When backups happen

- A few seconds after each stopped timer, and every hour while the app is open.
- When you press **Back up now**, which also makes a restore point.

A banner appears, and the **Settings** tab gets an amber **!** badge, when the last backup is too old or failed, or when the browser needs permission again. The sync button in the header lists the reason under **Other**.

## Several devices

You do not need to back up every space on every device.
When your devices sync, a recent backup made by another device counts for this one if it holds everything this device holds.
**Settings › Backup and safety** then says **Backed up by** that device and when, and no warning appears.
If you change something here that no recent backup holds yet, nothing happens at first: open the device that backs up (so it syncs and backs up), or download a backup.
Once the backup is older than the limit you chose, the warning names that device.
Only spaces a device keeps are affected, and a device that never syncs warns exactly as before.

## Restore

- On **Backup & restore** choose a backup from the list, **Restore from a backup file…** (a `.zip` or `.json`) or **Restore from a folder…**.
- **Restore to a time…** rebuilds your data as it was at a moment you pick.
- **Merge into this device** adds what is missing and keeps everything else. It is the safe choice, also on a new browser.
- **Replace local data…** makes this device exactly like the backup. It saves the current data first.

A damaged backup is shown with its problems and cannot be restored; pick an older one.

## Encrypted backups

Set a passphrase (the **Passphrase** line on **Settings**, or the sheet that opens when Yak needs it) for a folder others can read, then tick **Write only encrypted backups** on **Backup & restore**. It covers the files in your notes too.
**If you forget the passphrase, nobody can open those backups.**

## Go back in time

The last part of **Backup & restore** shows time entries, notes and tasks as they were at a time you choose, and what changed since.
Pick what to bring back; everything else stays as it is.
Notes also have a version history of their own.

The folder layout is documented for developers in `docs/backups.md`.

Before you erase a device (**Settings › Advanced › Erase everything on this device**), save the zip backup it offers: it holds your files too. Restore it on this page. See Devices and sync.
