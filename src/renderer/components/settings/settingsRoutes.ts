import type { SettingsTabType } from './types';

export type CanonicalSettingsTab =
  | 'general'
  | 'appearance'
  | 'companion'
  | 'shortcuts'
  | 'memory'
  | 'models'
  | 'usage'
  | 'privacy'
  | 'channels'
  | 'advanced'
  | 'about';

const LEGACY_TAB_MAP: Record<string, CanonicalSettingsTab> = {
  model: 'models',
  aisphere: 'models',
  coworkMemory: 'memory',
  im: 'channels',
  email: 'channels',
};

export function normalizeSettingsTab(
  tab?: SettingsTabType,
  fallback: CanonicalSettingsTab = 'general',
): SettingsTabType {
  if (!tab) return fallback;
  if (tab.startsWith('extension:')) return tab;
  return LEGACY_TAB_MAP[tab] ?? tab;
}
