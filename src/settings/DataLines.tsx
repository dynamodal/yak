import type * as Y from 'yjs';
import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { ownerKeys } from '../app/account-keys-runtime';
import { useApp } from '../app/context';
import { dataLines } from '../app/data-lines';
import { useYVersion } from '../app/hooks';
import { keyPrompt, withKey } from '../app/key-prompt';
import { Button, DataLine } from '../app/ui';
import { readAccountEncryption } from '../core/account-encryption';

/** The passphrase line: "Not set", locked, or unlocked with the minutes left (the unlock slides, F-324). Always shown (F-33); "Manage" opens it in the Passphrase section. */
function PassphraseLine() {
  const { account } = useApp();
  useYVersion(account.getMap('settings') as unknown as Y.AbstractType<unknown>);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    const stop = keyPrompt.subscribe(() => setTick((n) => n + 1));
    return () => {
      clearInterval(t);
      stop();
    };
  }, []);
  const has = !!readAccountEncryption(account);
  const left = Math.ceil(ownerKeys.current.unlockedLeft() / 60_000);
  const open = (): void => void withKey({ verb: 'continue', run: async () => undefined }).then(() => setTick((n) => n + 1), () => undefined);
  const text = !has ? 'Not set' : left > 0 ? `Unlocked · ${left} min` : 'Locked';
  return (
    <DataLine id="passphrase" tone={!has ? 'off' : left > 0 ? 'ok' : 'warn'} label="Passphrase" text={text}>
      {!has ? (
        <Button variant="link" onClick={open}>
          Create…
        </Button>
      ) : (
        <>
          {left > 0 ? null : (
            <>
              <Button variant="link" onClick={open}>
                Unlock…
              </Button>
              {' · '}
            </>
          )}
          <a href="#/settings/passphrase/manage">Manage</a>
        </>
      )}
    </DataLine>
  );
}

const OWN: { id: string; order: number; component: ComponentType }[] = [{ id: 'passphrase', order: 20, component: PassphraseLine }];

/** The status lines of Passphrase and import: the passphrase and whatever modules registered (`registerDataLine`: Import), each ending in a link. The Sync line is the Devices and sync section's. */
export function DataLines() {
  const all = [...dataLines(), ...OWN].sort((a, b) => a.order - b.order);
  return (
    <div class="st-lines" aria-label="Status">
      {all.map((l) => (
        <l.component key={l.id} />
      ))}
    </div>
  );
}
