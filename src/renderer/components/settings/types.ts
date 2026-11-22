import type { InferenceEdition } from '../../../shared/inferenceEdition';

type CanonicalTabType =
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

type LegacyTabType = 'model' | 'aisphere' | 'coworkMemory' | 'im' | 'email';

export type TabType = CanonicalTabType;
export type EnterpriseTabType = `extension:${string}`;
export type SettingsTabType = TabType | LegacyTabType | EnterpriseTabType;

export const toEnterpriseTab = (pageId: string): EnterpriseTabType => `extension:${pageId}`;
export const isEnterpriseTab = (tab: SettingsTabType): tab is EnterpriseTabType =>
  tab.startsWith('extension:');
export const fromEnterpriseTab = (tab: EnterpriseTabType): string => tab.slice('extension:'.length);

export type SettingsOpenOptions = {
  initialTab?: SettingsTabType;
  initialProvider?: string;
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
  onAskAi: (prompt: string) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  onOpenLocalModels?: () => void;
  enterpriseConfig?: SettingsEnterpriseConfig | null;
  managedModelsOnly?: boolean;
  inferenceEdition?: InferenceEdition;
}
