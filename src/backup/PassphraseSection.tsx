import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { ownerKeys } from '../app/account-keys-runtime';
import { keyPrompt, withKey } from '../app/key-prompt';
import { passphraseIsShort } from '../app/short-passphrase';
import { Button } from '../app/ui';
import { MIN_PASSPHRASE } from '../core/passphrase-rules';
import { AccountKeyCard } from './AccountKeyCard';
import { clearDeviceKey } from './encryption-state';
import { usePassphraseState } from './passphrase-state';
import { errText } from './store';

/**
 * Passphrase and import › Manage: what the passphrase protects and its state on this device. Setting
 * and entering it happen in the passphrase sheet, which opens when an action needs it (F-324), or from the
 * passphrase line on Settings; this section forgets it on this device.
 */
export function PassphraseSection() {
  const { account, accountId, deviceId } = useApp();
  const { params, hasKey, setHasKey } = usePassphraseState(account, accountId);
  const [error, setError] = useState('');
  const [, setTick] = useState(0);
  // The unlock runs out five minutes after its last use: look again now and then.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  const left = Math.ceil(ownerKeys.current.unlockedLeft() / 60_000);
  const start = (verb: string, fresh: boolean): void => {
    setError('');
    void withKey({ verb, fresh, run: async () => undefined })
      .then(() => setTick((n) => n + 1))
      .catch((e: unknown) => setError(errText(e)));
  };
  return (
    <section aria-label="Your passphrase" id="passphrase-manage">
      <div class="card" aria-label="What your passphrase protects">
        <h3>What your passphrase protects</h3>
        <ul>
          <li>Encrypted backups: nobody can open them without it.</li>
          <li>Approving and removing devices.</li>
          <li>Approving and ending shares.</li>
        </ul>
        <p class="hint">
          <strong>If you forget it, nobody can recover it.</strong> It is never stored, and nothing about it leaves this device.
        </p>
      </div>

      {!params ? null : (
        <div class="card" aria-label="Passphrase in use">
          <h3>Passphrase on this device</h3>
          <p data-unlock-status>{left > 0 ? `Unlocked: about ${left} more minute${left === 1 ? '' : 's'} if you do not use it.` : 'Locked. Yak asks for it when an action needs it.'}</p>
          <p>{hasKey ? 'This device has your passphrase and can write and read encrypted backups.' : 'This device does not have your passphrase yet, so it cannot write or read encrypted backups.'}</p>
          {passphraseIsShort() ? (
            <p class="hint" role="note" data-short-passphrase>
              Your passphrase is shorter than the {MIN_PASSPHRASE} characters new ones need. It keeps working, and a longer one, four or more random words, would be safer.
            </p>
          ) : null}
          <div class="row">
            {hasKey ? null : <Button onClick={() => start('continue', true)}>Use my passphrase on this device…</Button>}
            {hasKey ? (
              <Button
                onClick={() =>
                  void clearDeviceKey().then(
                    () => {
                      setHasKey(false);
                      // Other panels showing the passphrase state (Back up now) read it again.
                      keyPrompt.version++;
                      keyPrompt.emit();
                    },
                    (e: unknown) => setError(errText(e)),
                  )
                }
              >
                Forget the passphrase on this device
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {params ? <AccountKeyCard account={account} deviceId={deviceId} /> : null}
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
