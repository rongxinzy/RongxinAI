import {
  Box,
  Brain,
  CircleHelp,
  Keyboard,
  MailCheck,
  MessageCircleMore,
  Network,
  Route,
  SlidersHorizontal,
  SunMedium,
  type LucideIcon,
} from 'lucide-react';

import type { SettingsTabType, TabType } from './types';

export interface SettingsTabMeta {
  labelKey: string;
  icon: LucideIcon;
}

export const SETTINGS_TAB_METAS: Record<TabType, SettingsTabMeta> = {
  general: { labelKey: 'general', icon: SlidersHorizontal },
  appearance: { labelKey: 'appearance', icon: SunMedium },
  shortcuts: { labelKey: 'shortcuts', icon: Keyboard },
  model: { labelKey: 'model', icon: Box },
  aisphere: { labelKey: 'aisphereTab', icon: Network },
  triage: { labelKey: 'modelTriageTitle', icon: Route },
  coworkMemory: { labelKey: 'coworkMemoryTitle', icon: Brain },
  im: { labelKey: 'imBot', icon: MessageCircleMore },
  email: { labelKey: 'emailTab', icon: MailCheck },
  about: { labelKey: 'about', icon: CircleHelp },
};

export interface SettingsNavGroupDef {
  /** i18n key for the group title; null renders an untitled group. */
  titleKey: string | null;
  tabs: TabType[];
}

/**
 * Category sidebar grouping, aligned with the main sidebar's information
 * grouping. Enterprise extension tabs are injected into the last group
 * (before `about`) by useSettingsTabs.
 */
export const SETTINGS_NAV_GROUPS: SettingsNavGroupDef[] = [
  { titleKey: 'settingsGroupGeneral', tabs: ['general', 'appearance', 'shortcuts'] },
  { titleKey: 'settingsGroupModel', tabs: ['model', 'aisphere', 'triage', 'coworkMemory'] },
  { titleKey: 'settingsGroupChannels', tabs: ['im', 'email'] },
  { titleKey: null, tabs: ['about'] },
];

/**
 * Panels made of short label/control rows and a single reading column. Capping
 * them keeps the control within a comfortable scan distance instead of pinning
 * it to the far edge of a wide window.
 */
const COMPACT_SETTINGS_TABS: readonly SettingsTabType[] = [
  'general',
  'appearance',
  'shortcuts',
  'triage',
];

export function isCompactSettingsTab(tab: SettingsTabType): boolean {
  return COMPACT_SETTINGS_TABS.includes(tab);
}

export const SEND_SHORTCUT_OPTIONS = [
  { value: 'Enter', label: 'Enter', labelMac: 'Enter' },
  { value: 'Shift+Enter', label: 'Shift+Enter', labelMac: 'Shift+Enter' },
  { value: 'Ctrl+Enter', label: 'Ctrl+Enter', labelMac: 'Cmd+Enter' },
  { value: 'Alt+Enter', label: 'Alt+Enter', labelMac: 'Option+Enter' },
] as const;
