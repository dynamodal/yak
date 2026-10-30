import { describe, expect, it } from 'vitest';
import { type BeforeReplace, mergeBackOffered } from './replace';

describe('mergeBackOffered', () => {
  const at = new Date('2026-10-01T10:00:00Z');
  const before = (extra: Partial<BeforeReplace> = {}): BeforeReplace => ({ at: at.toISOString(), backupName: 'b', docs: [], ...extra });
  const day = 86_400_000;

  it('is offered for 45 days', () => {
    expect(mergeBackOffered(before(), at.getTime() + 44 * day)).toBe(true);
    expect(mergeBackOffered(before(), at.getTime() + 46 * day)).toBe(false);
  });

  it('goes once dismissed, and for a record from before the field existed it is offered', () => {
    expect(mergeBackOffered(before({ dismissed_at: at.toISOString() }), at.getTime() + day)).toBe(false);
    expect(mergeBackOffered(before(), at.getTime() + day)).toBe(true);
    expect(mergeBackOffered(undefined)).toBe(false);
  });
});
