import type { ComponentType } from 'preact';

/**
 * Pieces other modules add to the Settings page (F-33), so the page names no feature module:
 * the devices module adds its notices, key review, connection and reset to Devices and sync and to Advanced.
 */
export type SettingsSectionId = 'backups' | 'version-history' | 'recently-deleted' | 'passphrase' | 'devices-sync' | 'organize' | 'advanced';

export interface SettingsPartDef {
  id: string;
  section: SettingsSectionId;
  /** Position inside the section, lowest first. */
  order: number;
  component: ComponentType;
}

const parts: SettingsPartDef[] = [];

export function registerSettingsPart(def: SettingsPartDef): void {
  if (parts.some((p) => p.id === def.id)) return;
  parts.push(def);
  parts.sort((a, b) => a.order - b.order);
}

export function settingsParts(section: SettingsSectionId): readonly SettingsPartDef[] {
  return parts.filter((p) => p.section === section);
}
