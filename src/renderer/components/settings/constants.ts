import {
  BarChart3,
  Box,
  Brain,
  CircleHelp,
  Keyboard,
  MessageCircleMore,
  ShieldCheck,
  SlidersHorizontal,
  Smile,
  SunMedium,
  Wrench,
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
  companion: { labelKey: 'settingsTabCompanion', icon: Smile },
  shortcuts: { labelKey: 'shortcuts', icon: Keyboard },
  models: { labelKey: 'model', icon: Box },
  memory: { labelKey: 'coworkMemoryTitle', icon: Brain },
  usage: { labelKey: 'settingsTabUsage', icon: BarChart3 },
  privacy: { labelKey: 'settingsTabPrivacy', icon: ShieldCheck },
  channels: { labelKey: 'settingsTabChannels', icon: MessageCircleMore },
  advanced: { labelKey: 'settingsTabAdvanced', icon: Wrench },
  about: { labelKey: 'about', icon: CircleHelp },
};

export interface SettingsNavGroupDef {
  /** i18n key for the group title; null renders an untitled group. */
  titleKey: string | null;
  tabs: TabType[];
}

/**
 * Category sidebar grouping: Personal / AI / Connect / System.
 * Enterprise extension tabs are injected into the last group (before `about`)
 * by useSettingsTabs.
 */
export const SETTINGS_NAV_GROUPS: SettingsNavGroupDef[] = [
  { titleKey: 'settingsGroupPersonal', tabs: ['general', 'appearance', 'companion', 'shortcuts'] },
  { titleKey: 'settingsGroupAI', tabs: ['models', 'memory', 'usage', 'privacy'] },
  { titleKey: 'settingsGroupConnect', tabs: ['channels'] },
  { titleKey: 'settingsGroupSystem', tabs: ['advanced', 'about'] },
];

/**
 * Wide canvases are reserved for two-column memory workspaces and usage charts.
 * Every other settings page shares the compact reading column.
 */
const WIDE_SETTINGS_TABS: readonly SettingsTabType[] = ['memory', 'usage', 'coworkMemory'];

export function settingsContentWidthClass(tab: SettingsTabType): string {
  if (WIDE_SETTINGS_TABS.includes(tab)) return 'max-w-5xl';
  return 'max-w-3xl';
}

export const SEND_SHORTCUT_OPTIONS = [
  { value: 'Enter', label: 'Enter', labelMac: 'Enter' },
  { value: 'Shift+Enter', label: 'Shift+Enter', labelMac: 'Shift+Enter' },
  { value: 'Ctrl+Enter', label: 'Ctrl+Enter', labelMac: 'Cmd+Enter' },
  { value: 'Alt+Enter', label: 'Alt+Enter', labelMac: 'Option+Enter' },
] as const;
