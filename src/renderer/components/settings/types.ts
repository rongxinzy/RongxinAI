import type { AppUpdateRuntimeState } from '../../../shared/appUpdate/constants';
import type { ProviderType } from './model/constants';

export type TabType =
  | 'general'
  | 'appearance'
  | 'model'
  | 'triage'
  | 'coworkMemory'
  | 'shortcuts'
  | 'im'
  | 'email'
  | 'about';
export type EnterpriseTabType = `extension:${string}`;
export type SettingsTabType = TabType | EnterpriseTabType;

export const toEnterpriseTab = (pageId: string): EnterpriseTabType => `extension:${pageId}`;
export const isEnterpriseTab = (tab: SettingsTabType): tab is EnterpriseTabType =>
  tab.startsWith('extension:');
export const fromEnterpriseTab = (tab: EnterpriseTabType): string => tab.slice('extension:'.length);

export type SettingsOpenOptions = {
  initialTab?: SettingsTabType;
  initialProvider?: ProviderType;
  notice?: string;
  noticeI18nKey?: string;
  noticeExtra?: string;
};

export interface SettingsEnterpriseConfig {
  ui?: Record<string, 'hide' | 'disable' | 'readonly'>;
  disableUpdate?: boolean;
}

export interface SettingsPageProps extends SettingsOpenOptions {
  onClose: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  enterpriseConfig?: SettingsEnterpriseConfig | null;
  appUpdateState?: AppUpdateRuntimeState;
  managedModelsOnly?: boolean;
}
