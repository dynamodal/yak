import type * as Y from 'yjs';
import { useEffect, useState } from 'preact/hooks';
import { deviceFingerprint, readDeviceKey } from '../core/account-keys';
import { formatFingerprint } from '../core/keys';
import { useUnsealedKey } from '../app/key-hooks';
import { readAccountEncryption } from '../core/account-encryption';

/**
 * The lock state of a device (docs/sync.md, "Key model", compatible mode): whether it has published
 * its keys, and a short fingerprint to compare on two screens. Nothing is enforced yet.
 */
export function KeyState(props: { account: Y.Doc; deviceId: string; version: number }) {
  const rec = readDeviceKey(props.account, props.deviceId);
  const [fp, setFp] = useState('');
  useEffect(() => {
    let live = true;
    setFp('');
    if (rec) void deviceFingerprint(rec).then((f) => live && setFp(formatFingerprint(f, 2)));
    return () => {
      live = false;
    };
  }, [rec?.sign.x, rec?.sign.y, props.version]);
  if (!rec) return <span class="hint key-state" data-keys="none">No keys yet (an older version, or not opened since the update)</span>;
  return (
    <span class="hint key-state" data-keys="published">
      Has keys{fp ? <> · fingerprint <code>{fp}</code></> : null}
    </span>
  );
}

/** A line on Devices when the account has a backup passphrase but its key is not protected yet. */
export function AccountKeyHint(props: { account: Y.Doc }) {
  const key = useUnsealedKey(props.account);
  if (!key || !readAccountEncryption(props.account)) return null;
  return (
    <p class="hint" data-keys="unsealed">
      Your account key is not protected by your passphrase yet. <a href="#/settings/backup">Protect it in Backup &amp; restore</a>.
    </p>
  );
}
