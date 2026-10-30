# Privacy and data

Yak is alpha software with no warranty. Keep backups.

**In short:** your data stays in this browser unless you pair a device or share a space; then it travels encrypted, and nobody running Yak can read it.

## Two words used below

- **Relay**: a small server that passes sealed messages between your devices when they cannot reach each other directly. It is Yak's own, or ntfy.sh if you chose it.
- **STUN**: a public lookup service. A device asks it "what is my address on the internet?" so another device can find it. It sees that address and nothing else.

## On your device

- All notes, tasks, time entries and settings are stored in this browser. Nothing is uploaded unless you pair a device.
- Backups and the folder mirror write to folders you choose.
- Each backup also tells the devices that keep a space that the backup was made: your device's id, the time, whether it was a folder or a download, and the state vector of the space's documents (a short list of counters, no content). It travels only between your own devices that keep the space, in the space's log document, and is not part of any backup.
- Something you delete stays in your data, marked deleted, for 45 days so it can be restored (Settings › Recently deleted); files in notes keep their contents for those days too, unless you turn on **Delete files for good straight away**. **Delete for good** removes the contents on all your devices and leaves only a marker without contents. Older backups and Version history may still hold a copy.
- Debug-log switches, the shortcut list and similar choices stay on the device.

## Between your own devices

- Changes travel directly between your devices, encrypted with a key only they hold.
- Pairing needs the relay and STUN servers, which help devices find each other.
- The relay sees encrypted messages, their sizes and times, and the network addresses connecting to it. It cannot read the contents.
- STUN servers see the network address of a device asking for its public address. No content.
- If a direct link is impossible, encrypted data passes through the relay. It is still unreadable there.
- Adding a device with a one-time code (accounts that require device keys): the new device sends its name and public keys, and your device answers, through the relay, encrypted with the code. The relay cannot read them.
- Removing a device (accounts that require device keys): your other devices stop accepting it. It still knows the account's sync secret, so it could see that your devices are online, but not what they sync.

## Shared spaces

- A space shared with another person syncs only that space's shared part between your devices and theirs, encrypted and directly where possible. Private parts, logs and account settings never leave your own account.
- Everyone in a share can read, edit and delete what the space holds, and the other accounts' devices see how many of your devices are connected, and their network addresses on direct links.
- The share is set up through the relay (the link and its messages are encrypted with the link's code, the relay sees sizes, times and addresses). Names you give are shown to the other accounts.
- Ending a share or leaving stops new changes; nobody can take back what was already synced.

## What Cloudflare logs

- Yak runs on Cloudflare. Like any host, Cloudflare handles the network addresses of requests to deliver the site.
- Yak turns off Workers logs and traces and sets up no log export. The relay writes no request logs of its own.
- The relay keeps a topic's counters (messages and bytes in the last hours) to enforce limits, not content or device ids.

## Debug logs

- Each device keeps a log of connection and sync events, device names and network addresses; never the contents of notes or time entries.
- It also notes device keys: the first characters of the account key's fingerprint, how many devices were certified, a change of account key that was ignored, and when the key for two devices failed and they went back to the shared key. With device keys required, it also notes the switch, which devices were approved or removed (the first characters of their ids), that this device was removed, and joins by one-time code. Never a private key, a sync secret, a one-time code or the passphrase.
- File transfers add a line per file with the first characters of its checksum and its size, never its name or contents.
- It is shared only between your own devices and kept 7 days.
- Turn it off on a device page (**Settings**, then the device's name) under **Advanced › Logs from all devices**.
- Yak does not show a first-run notice about it; it is described here and next to that switch.

## Metrics

- The relay counts messages and bytes per hour and per message kind (connection or data link), with a short hash of the topic. No contents, addresses or device ids. Only the owner of the service can read these totals.
- Your account's own relay counts are shown on a device page (**Settings**, then the device's name).

## Reports by email

- **Report a problem** shows exactly what will be sent. Nothing is sent until you press a button, and it opens in your own mail app.
- With the details box ticked, a report holds the app version, browser, screen size, the page you were on and your device's debug log of the last day. Never notes or entries.

## What we do not do

- No tracking, no advertising, no analytics scripts and no third-party code at runtime.
- The code is public, so you can check all of this.

When what is collected changes, this page changes in the same release.
