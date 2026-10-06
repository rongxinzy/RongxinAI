import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { isProviderEnabled, ProviderName } from '../../../shared/providers';
import type { EnterpriseRendererSettingsPage } from '../../../shared/enterpriseRenderer';
import { defaultConfig } from '../../config';
import { configService } from '../../services/config';
import { coworkService } from '../../services/cowork';
import { i18nService, type LanguageType } from '../../services/i18n';
import { imService } from '../../services/im';
import { reconcileDefaultModelConfig } from '../../services/modelConfigReconciliation';
import { resolveManagedModelSettingsTab } from '../../services/managedModelUiPolicy';
import {
  buildAppSettingsSavePatch,
  getSettingsSaveErrorMessage,
} from '../../services/settingsSave';
import { themeService } from '../../services/theme';
import { selectCoworkConfig } from '../../store/selectors/coworkSelectors';
import ErrorMessage from '../ErrorMessage';
import { EnterpriseSettingsPage } from '../enterprise/EnterpriseSettingsPage';
import { localInferenceCompactButtonClass } from '../localInference/constants';
import PageHeader from '../PageHeader';
import AboutSettingsPanel from './about/AboutSettingsPanel';
import { AppearanceSettingsPanel } from './appearance/AppearanceSettingsPanel';
import type { EmailSettingsHandle } from './email/types';
import { EmailSettingsPage } from './email/EmailSettingsPage';
import GeneralSettingsPanel from './general/GeneralSettingsPanel';
import ImSettingsPanel from './im/ImSettingsPanel';
import { ManagedMemorySettings } from './memory/ManagedMemorySettings';
import ModelSettingsPanel, { type ModelSettingsHandle } from './model/ModelSettingsPanel';
import type { ProvidersConfig, ProviderType } from './model/constants';
import {
  getEffectiveApiFormat,
  hasProviderAuthConfigured,
  resolveBaseUrl,
} from './model/providerUtils';
import ShortcutsSettingsPanel from './shortcuts/ShortcutsSettingsPanel';
import TriageSettingsPanel from './triage/TriageSettingsPanel';
import {
  fromEnterpriseTab,
  isEnterpriseTab,
  toEnterpriseTab,
  type SettingsPageProps,
  type SettingsTabType,
} from './types';
import { useSettingsTabs } from './useSettingsTabs';

export default function SettingsPage({
  onClose,
  initialTab,
  initialProvider,
  notice,
  noticeI18nKey,
  noticeExtra,
  enterpriseConfig,
  appUpdateState,
  managedModelsOnly = false,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
}: SettingsPageProps) {
  // 状态
  const [requestedActiveTab, setActiveTab] = useState<SettingsTabType>(initialTab ?? 'general');
  const [enterpriseSettingsPages, setEnterpriseSettingsPages] = useState<
    readonly EnterpriseRendererSettingsPage[]
  >([]);
  const enterpriseModelTab = enterpriseSettingsPages.find(page => page.id === 'models');
  const activeTab = resolveManagedModelSettingsTab(
    requestedActiveTab,
    managedModelsOnly,
    enterpriseModelTab ? toEnterpriseTab(enterpriseModelTab.id) : undefined,
  );
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [language, setLanguage] = useState<LanguageType>('zh');
  const [useSystemProxy, setUseSystemProxy] = useState(false);
  const [sqliteAutoBackupEnabled, setSqliteAutoBackupEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buildNoticeMessage = useCallback((): string | null => {
    if (noticeI18nKey) {
      const base = i18nService.t(noticeI18nKey);
      return noticeExtra ? `${base} (${noticeExtra})` : base;
    }
    return notice ?? null;
  }, [notice, noticeExtra, noticeI18nKey]);

  const [noticeMessage, setNoticeMessage] = useState<string | null>(() => buildNoticeMessage());
  const [themeStyle, setThemeStyle] = useState(themeService.getStyle());
  const initialThemeStyleRef = useRef(themeService.getStyle());
  const initialThemeRef = useRef<'light' | 'dark' | 'system'>(themeService.getTheme());
  const initialLanguageRef = useRef<LanguageType>(i18nService.getLanguage());
  const didSaveRef = useRef(false);
  const emailSettingsRef = useRef<EmailSettingsHandle>(null);
  const modelHandleRef = useRef<ModelSettingsHandle | null>(null);

  useEffect(() => {
    let active = true;
    void window.electron.enterprise.renderer
      .settingsPages()
      .then(pages => {
        if (active) setEnterpriseSettingsPages(Array.isArray(pages) ? pages : []);
      })
      .catch(() => {
        if (active) setEnterpriseSettingsPages([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // 创建引用来确保内容区域的滚动
  const contentRef = useRef<HTMLDivElement>(null);
  // 快捷键设置
  const [shortcuts, setShortcuts] = useState({
    ...defaultConfig.shortcuts!,
  });

  const coworkConfig = useSelector(selectCoworkConfig);

  const [embeddingEnabled, setEmbeddingEnabled] = useState<boolean>(
    coworkConfig.embeddingEnabled ?? false,
  );
  const [embeddingProvider, setEmbeddingProvider] = useState<string>(
    coworkConfig.embeddingProvider ?? 'openai',
  );
  const [embeddingModel, setEmbeddingModel] = useState<string>(coworkConfig.embeddingModel ?? '');
  const [embeddingLocalModelPath, setEmbeddingLocalModelPath] = useState<string>(
    coworkConfig.embeddingLocalModelPath ?? '',
  );
  const [embeddingVectorWeight, setEmbeddingVectorWeight] = useState<number>(
    coworkConfig.embeddingVectorWeight ?? 0.7,
  );
  const [embeddingRemoteBaseUrl, setEmbeddingRemoteBaseUrl] = useState<string>(
    coworkConfig.embeddingRemoteBaseUrl ?? '',
  );
  const [embeddingRemoteApiKey, setEmbeddingRemoteApiKey] = useState<string>(
    coworkConfig.embeddingRemoteApiKey ?? '',
  );

  useEffect(() => {
    setEmbeddingEnabled(coworkConfig.embeddingEnabled ?? false);
    setEmbeddingProvider(coworkConfig.embeddingProvider ?? 'openai');
    setEmbeddingModel(coworkConfig.embeddingModel ?? '');
    setEmbeddingLocalModelPath(coworkConfig.embeddingLocalModelPath ?? '');
    setEmbeddingVectorWeight(coworkConfig.embeddingVectorWeight ?? 0.7);
    setEmbeddingRemoteBaseUrl(coworkConfig.embeddingRemoteBaseUrl ?? '');
    setEmbeddingRemoteApiKey(coworkConfig.embeddingRemoteApiKey ?? '');
  }, [
    coworkConfig.embeddingEnabled,
    coworkConfig.embeddingProvider,
    coworkConfig.embeddingModel,
    coworkConfig.embeddingLocalModelPath,
    coworkConfig.embeddingVectorWeight,
    coworkConfig.embeddingRemoteBaseUrl,
    coworkConfig.embeddingRemoteApiKey,
  ]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const config = await configService.reload();
        if (!active) return;

        // Set general settings
        initialThemeRef.current = config.theme;
        initialLanguageRef.current = config.language;
        setTheme(config.theme);
        setThemeStyle(themeService.getStyle());
        setLanguage(config.language);
        setUseSystemProxy(config.useSystemProxy ?? false);
        setSqliteAutoBackupEnabled(config.sqliteAutoBackupEnabled === true);

        // 加载快捷键设置
        if (config.shortcuts) {
          setShortcuts(prev => ({
            ...prev,
            ...config.shortcuts,
          }));
        }
      } catch {
        if (active) {
          setError(i18nService.t('settingsLoadFailed'));
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const initialTheme = initialThemeRef.current;
    const initialThemeStyle = initialThemeStyleRef.current;
    const initialLanguage = initialLanguageRef.current;
    return () => {
      if (didSaveRef.current) {
        return;
      }
      themeService.setStyle(initialThemeStyle);
      themeService.setTheme(initialTheme);
      i18nService.setLanguage(initialLanguage, { persist: false });
    };
  }, []);

  // 监听标签页切换，确保内容区域滚动到顶部
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    setNoticeMessage(buildNoticeMessage());
  }, [buildNoticeMessage]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18nService.subscribe(() => {
      setLanguage(i18nService.getLanguage());
      // Re-translate notice message on language change
      if (noticeI18nKey) {
        const base = i18nService.t(noticeI18nKey);
        setNoticeMessage(noticeExtra ? `${base} (${noticeExtra})` : base);
      }
    });
    return unsubscribe;
  }, [noticeI18nKey, noticeExtra]);

  const hasCoworkConfigChanges =
    embeddingEnabled !== (coworkConfig.embeddingEnabled ?? false) ||
    embeddingProvider !== (coworkConfig.embeddingProvider ?? 'openai') ||
    embeddingModel !== (coworkConfig.embeddingModel ?? '') ||
    embeddingLocalModelPath !== (coworkConfig.embeddingLocalModelPath ?? '') ||
    embeddingVectorWeight !== (coworkConfig.embeddingVectorWeight ?? 0.7) ||
    embeddingRemoteBaseUrl !== (coworkConfig.embeddingRemoteBaseUrl ?? '') ||
    embeddingRemoteApiKey !== (coworkConfig.embeddingRemoteApiKey ?? '');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    let appConfigSaved = false;

    try {
      const emailSaved = (await emailSettingsRef.current?.saveIfDirty()) ?? true;
      if (!emailSaved) {
        setActiveTab('email');
        return;
      }

      const modelSaveSnapshot = modelHandleRef.current?.getSaveSnapshot();
      if (!modelSaveSnapshot) {
        throw new Error(i18nService.t('failedToSaveSettings'));
      }
      const { providers, activeProvider } = modelSaveSnapshot;

      const normalizedProviders = Object.fromEntries(
        Object.entries(providers).map(([providerKey, providerConfig]) => {
          const apiFormat = getEffectiveApiFormat(providerKey, providerConfig.apiFormat);
          const hasValidAuth = hasProviderAuthConfigured(
            providerKey as ProviderType,
            providerConfig,
          );
          const normalizedEnabled =
            providerKey === ProviderName.Zhiyuan
              ? true
              : providerKey === ProviderName.LlamaCpp
                ? providerConfig.userEnabled === true
                : providerConfig.enabled && hasValidAuth;
          return [
            providerKey,
            {
              ...providerConfig,
              enabled: normalizedEnabled,
              userEnabled:
                providerKey === ProviderName.LlamaCpp
                  ? normalizedEnabled
                  : providerConfig.userEnabled,
              apiFormat,
              baseUrl: resolveBaseUrl(
                providerKey as ProviderType,
                providerConfig.baseUrl,
                apiFormat,
              ),
            },
          ];
        }),
      ) as ProvidersConfig;

      // Prefer a remote enabled provider for the app-wide fallback API, then
      // fall back to any enabled local provider such as llama.cpp.
      const firstEnabledProvider =
        Object.entries(normalizedProviders).find(
          ([providerKey, config]) =>
            providerKey !== ProviderName.LlamaCpp && isProviderEnabled(providerKey, config),
        ) ??
        Object.entries(normalizedProviders).find(([providerKey, config]) =>
          isProviderEnabled(providerKey, config),
        );

      const primaryProvider = firstEnabledProvider
        ? firstEnabledProvider[1]
        : normalizedProviders[activeProvider];

      const currentAppConfig = configService.getConfig();
      const appConfigPatch = buildAppSettingsSavePatch({
        current: currentAppConfig,
        theme,
        themeStyle,
        language,
        useSystemProxy,
        sqliteAutoBackupEnabled,
        shortcuts,
        providers: normalizedProviders,
        api: {
          key: primaryProvider.apiKey,
          baseUrl: primaryProvider.baseUrl,
        },
        model: reconcileDefaultModelConfig(currentAppConfig, normalizedProviders),
      });
      if (Object.keys(appConfigPatch).length > 0) {
        await configService.updateConfig(appConfigPatch);
        appConfigSaved = true;
      }

      // 应用主题
      themeService.setStyle(themeStyle);
      themeService.setTheme(theme);

      // 应用语言
      i18nService.setLanguage(language, { persist: false });

      if (hasCoworkConfigChanges) {
        const updated = await coworkService.updateConfig({
          embeddingEnabled,
          embeddingProvider,
          embeddingModel,
          embeddingLocalModelPath,
          embeddingVectorWeight,
          embeddingRemoteBaseUrl,
          embeddingRemoteApiKey,
        });
        if (!updated) {
          throw new Error(i18nService.t('coworkConfigSaveFailed'));
        }
      }

      const channelConfigSynced = await imService.syncPendingConfig();
      if (!channelConfigSynced) {
        throw new Error(i18nService.t('coworkConfigSaveFailed'));
      }

      didSaveRef.current = true;
      onClose();
    } catch (error) {
      setError(getSettingsSaveErrorMessage(error, appConfigSaved, key => i18nService.t(key)));
    } finally {
      setIsSaving(false);
    }
  };

  // 标签页切换处理
  const handleTabChange = (tab: SettingsTabType) => {
    if (tab !== 'model') {
      modelHandleRef.current?.resetModelEditorOnProviderSwitch();
    }
    setActiveTab(tab);
  };

  // Mapping from shortcut key to i18n label key for conflict messages
  const shortcutLabelMap: Record<string, string> = {
    newChat: 'newChat',
    search: 'search',
    settings: 'openSettings',
    sendMessage: 'sendMessageShortcut',
  };

  // 快捷键更新处理
  const handleShortcutChange = (key: keyof typeof shortcuts, value: string) => {
    // Check for conflicts with other shortcuts (skip unset values)
    const conflictKey =
      value &&
      Object.keys(shortcuts).find(
        k =>
          k !== key &&
          shortcuts[k as keyof typeof shortcuts] &&
          shortcuts[k as keyof typeof shortcuts] === value,
      );
    if (conflictKey) {
      const conflictLabel = i18nService.t(shortcutLabelMap[conflictKey] ?? conflictKey);
      setNoticeMessage(
        i18nService.t('shortcutConflict').replace('{0}', value).replace('{1}', conflictLabel),
      );
      return;
    }
    setShortcuts(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSettingsFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) {
      return;
    }
    event.preventDefault();
  };

  const { groups: navGroups, tabs: sidebarTabs } = useSettingsTabs({
    enterpriseSettingsPages,
    language,
    enterpriseConfig,
    managedModelsOnly,
  });

  const activeTabLabel = useMemo(() => {
    return sidebarTabs.find(t => t.key === activeTab)?.label ?? '';
  }, [activeTab, sidebarTabs]);

  const renderTabContent = () => {
    if (isEnterpriseTab(activeTab)) {
      const pageId = fromEnterpriseTab(activeTab);
      const page = enterpriseSettingsPages.find(candidate => candidate.id === pageId);
      return page ? <EnterpriseSettingsPage page={page} title={activeTabLabel} /> : null;
    }
    switch (activeTab) {
      case 'general':
        return (
          <GeneralSettingsPanel
            language={language}
            onLanguageChange={nextLanguage => {
              setLanguage(nextLanguage);
              i18nService.setLanguage(nextLanguage, { persist: false });
            }}
            useSystemProxy={useSystemProxy}
            onUseSystemProxyChange={next => setUseSystemProxy(next)}
            sqliteAutoBackupEnabled={sqliteAutoBackupEnabled}
            onSqliteAutoBackupEnabledChange={next => setSqliteAutoBackupEnabled(next)}
            setError={setError}
          />
        );

      case 'appearance':
        return (
          <AppearanceSettingsPanel
            appearance={theme}
            styleId={themeStyle}
            onAppearanceChange={mode => {
              setTheme(mode);
              themeService.setTheme(mode);
            }}
            onStyleChange={id => {
              setThemeStyle(id);
              themeService.setStyle(id);
            }}
          />
        );

      case 'coworkMemory':
        return <ManagedMemorySettings workingDirectory={coworkConfig.workingDirectory} />;

      case 'triage':
        return <TriageSettingsPanel />;

      case 'shortcuts':
        return (
          <ShortcutsSettingsPanel shortcuts={shortcuts} onShortcutChange={handleShortcutChange} />
        );

      case 'im':
        return <ImSettingsPanel />;

      case 'about':
        return (
          <AboutSettingsPanel
            appUpdateState={appUpdateState}
            setError={setError}
            setNoticeMessage={setNoticeMessage}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div data-page-canvas className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <PageHeader
        title={activeTabLabel}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
      />

      <div className="flex min-h-0 flex-1">
        {/* Category sidebar */}
        <nav
          aria-label={i18nService.t('settings')}
          className="theme-shell-sidebar flex w-[220px] shrink-0 flex-col gap-4 overflow-y-auto px-2 py-4"
        >
          {navGroups.map((group, groupIndex) => (
            <div key={group.title ?? groupIndex} className="flex flex-col gap-1">
              {group.title ? (
                <div className="theme-shell-sidebar-section flex items-center">{group.title}</div>
              ) : null}
              {group.tabs.map(tab => (
                <Button
                  type="button"
                  key={tab.key}
                  variant="navigation"
                  size="navigation"
                  data-active={activeTab === tab.key || undefined}
                  aria-current={activeTab === tab.key ? 'page' : undefined}
                  onClick={() => handleTabChange(tab.key)}
                >
                  <div className="flex size-4 shrink-0 items-center justify-center">
                    <tab.icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  </div>
                  <span className="min-w-0 truncate">{tab.label}</span>
                </Button>
              ))}
            </div>
          ))}
        </nav>

        {/* Right content */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {noticeMessage && (
            <div className="px-4 sm:px-6">
              <ErrorMessage message={noticeMessage} onClose={() => setNoticeMessage(null)} />
            </div>
          )}

          {error && (
            <div className="px-4 sm:px-6">
              <ErrorMessage message={error} onClose={() => setError(null)} />
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            onKeyDown={handleSettingsFormKeyDown}
            className="flex flex-col flex-1 overflow-hidden"
          >
            {/* Tab content */}
            <div
              ref={contentRef}
              className={cn(
                'flex-1',
                isEnterpriseTab(activeTab)
                  ? 'overflow-hidden'
                  : 'overflow-y-auto px-4 py-4 sm:px-6',
              )}
              style={{ scrollbarGutter: 'stable' }}
            >
              <div className={activeTab === 'email' ? 'block' : 'hidden'}>
                <EmailSettingsPage ref={emailSettingsRef} />
              </div>
              <div className={activeTab === 'model' ? 'block h-full' : 'hidden'}>
                <ModelSettingsPanel
                  initialProvider={initialProvider}
                  language={language}
                  handleRef={modelHandleRef}
                  setError={setError}
                  setNoticeMessage={setNoticeMessage}
                />
              </div>
              {activeTab !== 'email' && activeTab !== 'model' && renderTabContent()}
            </div>

            {/* Footer buttons */}
            {!isEnterpriseTab(activeTab) && (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-background p-4">
                <Button
                  type="button"
                  variant="ghost"
                  className="theme-confirm-cancel min-w-16"
                  onClick={onClose}
                  disabled={isSaving}
                >
                  {i18nService.t('cancel')}
                </Button>
                {/* 2026/09/17 lixiang  设置保存按钮使用主题色 default 风格 */}
                <Button
                  type="submit"
                  variant="default"
                  className={localInferenceCompactButtonClass}
                  disabled={isSaving}
                >
                  {isSaving ? i18nService.t('saving') : i18nService.t('save')}
                </Button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
