/**
 * The name a vault joins under unless its owner chose one (#118): the vault name alone is the same
 * on a phone and a laptop, so the platform and the first characters of the device id are added.
 */
export function defaultDeviceName(vaultName: string, mobile: boolean, deviceId: string): string {
  return `Obsidian (${vaultName}, ${mobile ? 'mobile' : 'desktop'}, ${deviceId.slice(0, 4)})`;
}

/** The status line at the top of the settings tab (#120). */
export function syncStatusLine(s: { joined: boolean; joining: boolean; connected: number; devices: number }): string {
  if (!s.joined) return s.joining ? 'Joining. Waiting for your other device.' : 'Not joined. Paste a sync code below to join.';
  if (s.devices <= 1) return s.connected > 0 ? `Syncing with ${s.connected} other ${s.connected === 1 ? 'device' : 'devices'}.` : 'Joined. No other device is connected right now.';
  return `Syncing ${s.connected} of ${s.devices - 1} other devices.`;
}
