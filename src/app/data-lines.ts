import type { ComponentType } from 'preact';

/**
 * A status line of Backup and safety on Settings (F-33): backup, passphrase, import. A module adds its own line
 * with `registerDataLine`, so the Settings page names no feature. Each line is one sentence ending in a link;
 * render nothing when there is nothing to say. The passphrase and sync lines belong to the page itself.
 */
export interface DataLineDef {
  id: string;
  /** Position among the lines, lowest first. */
  order: number;
  component: ComponentType;
}

const lines: DataLineDef[] = [];

export function registerDataLine(def: DataLineDef): void {
  if (lines.some((l) => l.id === def.id)) return;
  lines.push(def);
  lines.sort((a, b) => a.order - b.order);
}

export function dataLines(): readonly DataLineDef[] {
  return lines;
}
