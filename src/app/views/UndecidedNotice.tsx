import type * as Y from 'yjs';
import { useApp } from '../context';
import { useYVersion } from '../hooks';
import { Button } from '../ui';
import { keepsPendingApproval, safeStorage } from '../join';
import { declineUndecided, decided, keeps, keepsMap, keepUndecided, setKeeps } from '../../core/keeps';

/**
 * The spaces this device has not decided on (a device that has just joined, or a new space): keep it, or not, one by one or all at once.
 * Nothing of a space is sent to a device until it is decided. Shown on Settings (Your data) and on the device view.
 */
export function UndecidedNotice() {
  const { account, allSpaces, deviceId } = useApp();
  useYVersion(keepsMap(account) as unknown as Y.AbstractType<unknown>);
  // An approved join keeps the account's spaces itself in a moment (F-20): do not flash the question.
  if (keepsPendingApproval(safeStorage())) return null;
  const undecided = allSpaces.filter((s) => !decided(account, deviceId, s.id));
  const keepsNothing = allSpaces.every((s) => !keeps(account, deviceId, s.id));
  if (allSpaces.length === 0) {
    return (
      <div class="notice" role="status" data-undecided>
        <p>
          <strong>This device keeps no spaces yet.</strong> The spaces of your account have not arrived yet. Keep Yak open on one of your other devices; they arrive by themselves.
        </p>
      </div>
    );
  }
  if (undecided.length === 0) return null;
  return (
    <div class="notice" role="status" data-undecided>
      <p>
        <strong>{keepsNothing && undecided.length === allSpaces.length ? 'This device keeps no spaces yet.' : 'Some spaces are not decided for this device.'}</strong> Nothing of a space is sent to it until you choose.
      </p>
      <ul class="undecided">
        {undecided.map((s) => (
          <li key={s.id}>
            <span>
              {keepsNothing ? 'Space' : 'New space'}: {s.name}. Keep it on this device?
            </span>{' '}
            <Button onClick={() => setKeeps(account, deviceId, s.id, true)} title={`Keep ${s.name} on this device`} aria-label={`Keep ${s.name}`}>
              Keep
            </Button>{' '}
            <Button onClick={() => setKeeps(account, deviceId, s.id, false)} title={`Do not keep ${s.name} on this device`} aria-label={`Not on this device: ${s.name}`}>
              Not on this device
            </Button>
          </li>
        ))}
      </ul>
      <p>
        <Button onClick={() => keepUndecided(account, deviceId, undecided.map((s) => s.id))} title="Keep every space this device has not decided on">
          Keep all spaces
        </Button>{' '}
        <Button onClick={() => declineUndecided(account, deviceId, undecided.map((s) => s.id))} title="Keep none of the spaces this device has not decided on">
          None of these
        </Button>
      </p>
    </div>
  );
}
