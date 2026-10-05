import { Box, Users, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';

import type { EnterpriseRendererSettingsPage } from '../../../shared/enterpriseRenderer';
import { filterManagedModelSettingsTabs } from '../../services/managedModelUiPolicy';
import { i18nService, type LanguageType } from '../../services/i18n';
import { EnterpriseSettingsPageId } from '../enterprise/constants';
import { SETTINGS_NAV_GROUPS, SETTINGS_TAB_METAS } from './constants';
import { toEnterpriseTab, type SettingsEnterpriseConfig, type SettingsTabType } from './types';

export interface SettingsNavTab {
  key: SettingsTabType;
  label: string;
  icon: LucideIcon;
}

export interface SettingsNavGroup {
  title: string | null;
  tabs: SettingsNavTab[];
}

interface UseSettingsTabsParams {
  enterpriseSettingsPages: readonly EnterpriseRendererSettingsPage[];
  language: LanguageType;
  enterpriseConfig?: SettingsEnterpriseConfig | null;
  managedModelsOnly: boolean;
}

const enterpriseIconForPage = (pageId: string): LucideIcon =>
  pageId === EnterpriseSettingsPageId.Models ? Box : Users;

/**
 * Builds the category sidebar entries: static per-tab metadata, enterprise
 * extension pages injected before `about`, enterprise `ui.*: hide` filtering
 * and managed-models-only tab filtering, then regrouped for rendering.
 */
export function useSettingsTabs({
  enterpriseSettingsPages,
  language,
  enterpriseConfig,
  managedModelsOnly,
}: UseSettingsTabsParams): { groups: SettingsNavGroup[]; tabs: SettingsNavTab[] } {
  return useMemo(() => {
    const flatTabs: SettingsNavTab[] = [];
    for (const group of SETTINGS_NAV_GROUPS) {
      for (const tabKey of group.tabs) {
        if (tabKey === 'about' && enterpriseSettingsPages.length > 0) {
          for (const page of enterpriseSettingsPages) {
            flatTabs.push({
              key: toEnterpriseTab(page.id),
              label: page.labels[language],
              icon: enterpriseIconForPage(page.id),
            });
          }
        }
        const meta = SETTINGS_TAB_METAS[tabKey];
        flatTabs.push({ key: tabKey, label: i18nService.t(meta.labelKey), icon: meta.icon });
      }
    }

    // Filter out tabs with 'hide' action in enterprise config
    // e.g., ui: { "settings.im": "hide" } → hide the 'im' tab
    const ui = enterpriseConfig?.ui;
    const configuredTabs = ui
      ? flatTabs.filter(tab => ui[`settings.${tab.key}`] !== 'hide')
      : flatTabs;
    const tabs = filterManagedModelSettingsTabs(configuredTabs, managedModelsOnly);

    const groups: SettingsNavGroup[] = [];
    for (const group of SETTINGS_NAV_GROUPS) {
      const groupTabs: SettingsNavTab[] = [];
      for (const tabKey of group.tabs) {
        if (tabKey === 'about') {
          for (const page of enterpriseSettingsPages) {
            const enterpriseKey = toEnterpriseTab(page.id);
            const enterpriseTab = tabs.find(tab => tab.key === enterpriseKey);
            if (enterpriseTab) groupTabs.push(enterpriseTab);
          }
        }
        const tab = tabs.find(candidate => candidate.key === tabKey);
        if (tab) groupTabs.push(tab);
      }
      if (groupTabs.length > 0) {
        groups.push({
          title: group.titleKey ? i18nService.t(group.titleKey) : null,
          tabs: groupTabs,
        });
      }
    }

    return { groups, tabs };
  }, [enterpriseConfig?.ui, enterpriseSettingsPages, language, managedModelsOnly]);
}
