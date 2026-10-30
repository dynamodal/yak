import type * as Y from 'yjs';
import { useState } from 'preact/hooks';
import { useHoldsKey, useUnsealedKey } from '../app/key-hooks';
import { deviceName, isLeft, isRemoved } from '../core/devices';
import { withKey } from '../app/key-prompt';
import { Button } from '../app/ui/Button';
import { errText } from './store';

/**
 * Accounts that set encrypted backups before the account key existed have a passphrase but an
 * unsealed key, and sealing needs the passphrase typed (it is not stored). Shown on the device that
 * can seal it; elsewhere it says where to go, and what to do when that device is gone.
 */
export function AccountKeyCard(props: { account: Y.Doc; deviceId: string }) {
  const { account, deviceId } = props;
  const key = useUnsealedKey(account);
  const holds = useHoldsKey(key?.fingerprint);
  const [error, setError] = useState('');
  if (!key) return null;
  // Only a removed or left creator can be replaced (S-76s, #256): other devices cannot check a claim that it lost its key.
  const gone = isRemoved(account, key.by) || isLeft(account, key.by);
  const mine = key.by === deviceId && holds !== false;
  if (!gone && key.by === deviceId && holds === false) {
    return (
      <div class="card" aria-label="Protect the account key">
        <p>
          This device started the passphrase setup but lost part of it, so it cannot finish it. On another device, remove this one in Devices, then enter your backup passphrase there in Settings › Passphrase and import › Manage passphrase to start again. You
          can allow this device again afterwards.
        </p>
      </div>
    );
  }
  if (!gone && !mine) {
    const name = deviceName(account, key.by) ?? 'the device that made it';
    return (
      <div class="card" aria-label="Protect the account key">
        <p>
          The passphrase setup was started on {name} and is not finished. Enter your backup passphrase on that device, in Settings › Passphrase and import › Manage passphrase. If it is gone, remove it in Devices, then enter the passphrase here to start again.
        </p>
      </div>
    );
  }
  return (
    <div class="card" aria-label="Protect the account key">
      <p>Your passphrase is not fully set up yet. Enter it once to finish.</p>
      {gone ? (
        <p class="hint" role="note">
          The device that made the account key no longer has it, so this starts a <strong>new setup</strong>. Every device reloads once to follow it.
        </p>
      ) : null}
      <div class="row">
        <Button
          variant="primary"
          onClick={() => {
            setError('');
            void withKey({ verb: 'finish', fresh: true, run: async () => undefined }).catch((e: unknown) => setError(errText(e)));
          }}
        >
          Finish passphrase setup…
        </Button>
      </div>
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
