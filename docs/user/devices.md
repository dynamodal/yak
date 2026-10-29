# Devices and sync

Sync is optional and only between your own devices. Everything works without it.

**Both devices must be open at the same time to exchange changes.** Edits made offline sync when they meet.

## Start syncing and add a device

1. On the first device open **Settings**, choose **+ Add a device**, then **Start syncing my devices**. If you have no passphrase yet, a sheet asks you to create one: Yak suggests words, or you type your own, and you tick **I've written it down**.
2. On the new device choose **Join my other device** when it starts, or open **Settings** and choose **+ Add a device** if it already runs. Enter the one-time code from step 3.
3. On the first device choose **Make a one-time code** on the same page. It shows a QR code and a link first: scan the QR code on the new device, or choose **Send link** (where your browser has a share sheet) or **Copy link** and open it there. To type instead, the code is shown in groups of four with a **Copy code** button, and the new device's code field also takes a pasted link. Both screens then show a short code. If they match, choose **The codes match** on the new device and **Approve** on the other. If not, start again. A code adds one device and works for 15 minutes.
4. Pairing is done once. Devices reconnect by themselves while the app is open.

- A new passphrase needs at least 20 characters. Under 28 it works but is warned about: four or more random words is best.
- Approving, removing a device and sharing ask for your passphrase in a sheet, and then carry on by themselves. It stays unlocked for 5 minutes after you last used it, so a run of actions asks once.
- A device you did not approve stops syncing. You can approve it later under **Settings › Advanced › Device keys and ids**.
- If Yak ever has to go back to an earlier version, your devices stop syncing until it is updated again. Nothing is lost.

## Switching an older account to device keys

An account made before device keys were always on still lets any device that holds its old code join.
**Settings › Advanced › Device keys and ids** shows **Switch to device keys** on it.

1. Compare each device's fingerprint with the one in Advanced on that device, and tick the ones you recognise.
2. Choose **Switch to device keys**; a sheet asks for your passphrase (to create one if you have none). This cannot be undone.
3. Before you press it, the page lists the devices that will have to join again.

A device that is not ticked, has no keys yet or runs an older Yak stops syncing, but nothing on it is deleted.
Open its row in **Settings › Devices and sync**, choose **Join again or remove this device**, then **Join again with a one-time code**, and approve it from another device: what it wrote meanwhile merges back.
Update Yak on it first if it is old.

## What to expect

- Changes travel directly between devices, encrypted. A small connection server only helps them find each other (the relay, this site's own, is the default).
- Some networks (company Wi-Fi, some mobile carriers) block direct connections. Devices then fall back to the relay, which is slower and **carries no attachments**: files in notes arrive when a direct link works.
- The sync button at the right of the header shows the state by its shape as well as its colour, and opens the list of devices and how each is linked:
  - Grey square: sync is off, or no other device is paired yet.
  - Filled green circle: linked to at least one device directly.
  - Green ring: linked only through the relay, which only carries sealed data and is slower.
  - Amber triangle: paired, but no device is linked now.
- The **Sync** line on Settings, the status line on the Devices pages and each device's row use the same shapes: a filled circle for a device linked directly, a ring for one linked only through the relay, a triangle for one that is connecting or not linked, a square when sync is off. The row's words say the same ("Syncing directly", "Syncing through the relay", "Connecting…", "Waiting").
- The **Sync** line on Settings (always shown, even when sync is off) and the device rows explain it further.
- Phones pause pages in the background, so sync happens while the page is open.
- If two devices edit the same thing, both edits are merged; nothing is lost silently.

## Remove or leave

On a device page you can remove a device from the account or leave it from this one.
A removed device, or one that no longer finds your other devices, comes back with **Join again with a one-time code**: it keeps its data, and you approve it from another device.
Backups are the safety net for either: see [Backups and history](#/help/backups).

## Start again on one device

Two actions in **Settings › Advanced** clear a device. Neither touches your other devices.

- **Re-sync this device (keeps settings and files)** throws away this device's copy of one space, or of everything, and fills it again from a linked device or a backup.
  - It erases the records of the space you choose (everything also erases the account document and the sync code), and the history log if you tick that.
  - It keeps this device's id, settings, files in notes, the backup folder choice, restore points and the offline copy of the app.
  - Use it when this device's copy has drifted or is bad.
- **Erase everything on this device** removes every trace of Yak from this browser, so it starts as on a first visit (the Welcome screen).
  - It erases all documents, files, history, restore points, the sync code and keys, settings, the backup folder choice, and the offline copy.
  - It keeps other devices, backup files you saved, and any Mirror folder.
  - Yak first offers a safety backup (a zip with your files) and says if this device has data that is not backed up or not yet on another device.
  - Other open Yak tabs reload. If the browser keeps anything, Yak says what; use the browser's "Clear site data" for this site to remove the rest.

## Sharing a space

With device keys required, a space can be shared with another account: open the space's row under **Settings › Spaces** and choose **+ Share <space> with an account** under Shared with (the row also tells which of your devices keep the space). A share does not give them any of your devices or your other spaces. Removing one of your devices from your account also removes it from your shares.

Trust limits, in plain words:
- Every device you approve is trusted with your whole account. A device you told to keep only some spaces is not stopped from asking for the others, so approve only devices you own.
- Everyone in a share can read, edit and delete everything in that space, and so can all their devices.
- Ending a share or removing someone stops new changes; it cannot take back what they already synced.
- Share a space only with people you would trust with a copy of it.

## Passphrase

Yak asks for your passphrase in one sheet, when an action needs it. The **Passphrase** line on **Settings** shows whether it is unlocked and opens the sheet; **Backup & restore** lets you forget it on this device.
Yak shows a new passphrase once, when you create it. Write it down or keep it in a password manager: Yak cannot recover it and nobody can reset it for you.

**If you lose the passphrase:**
- Devices already approved keep working and your data stays on them.
- You can no longer approve a new device, remove a device or make or end a share, because those need the passphrase.
- Encrypted backups can no longer be opened.
- Back up while you still have it, and keep it somewhere safe.
A device that syncs with nothing else can share a space too: creating the passphrase in the sheet is all it takes.
It needs at least 20 characters; four or more random words is best. **Show** reveals what you type.
Older, shorter passphrases keep working.
