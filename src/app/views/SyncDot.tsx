import type { ComponentType } from 'preact';
import { IconSyncDirect, IconSyncOff, IconSyncOffline, IconSyncRelay } from '../ui';
import { cx } from '../ui/cx';
import type { SyncShape } from '../sync-state';

/** The header's four shapes (F-33h), one icon each. Shared by the header button, the device rows and the Sync lines (S-75). */
export const SHAPE_ICON: Record<SyncShape, ComponentType> = {
  off: IconSyncOff,
  direct: IconSyncDirect,
  relay: IconSyncRelay,
  offline: IconSyncOffline,
};

/**
 * A small sync shape: square, disc, ring or triangle, coloured like the header button. Decorative unless `label` is
 * given (a row with no text of its own for the state): the text beside it already names the state, so the shape
 * never carries the meaning alone.
 */
export function SyncDot({ shape, label }: { shape: SyncShape; label?: string }) {
  const Icon = SHAPE_ICON[shape];
  return (
    <span class={cx('sync-dot', 'sync-shape', shape)} data-shape={shape} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}>
      <Icon />
    </span>
  );
}
