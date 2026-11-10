## 2026-11-10: Sync no longer gets stuck reconnecting

- A device whose connection server was briefly unreachable could keep restarting its connection every half second and stop syncing until reloaded; it now waits and retries calmly.
