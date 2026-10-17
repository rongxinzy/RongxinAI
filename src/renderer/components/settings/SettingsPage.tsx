import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type { EnterpriseRendererSettingsPage } from '../../../shared/enterpriseRenderer';
import { defaultConfig } from '../../config';
import { configService } from '../../services/config';
import { coworkService } from '../../services/cowork';
import { i18nService, type LanguageType } from '../../services/i18n';
import { imService } from '../../services/im';
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
import { AISphereSettings } from './AISphereSettings';
import { AppearanceSettingsPanel } from './appearance/AppearanceSettingsPanel';
import type { EmailSettingsHandle } from './email/types';
import { EmailSettingsPage } from './email/EmailSettingsPage';
import GeneralSettingsPanel from './general/GeneralSettingsPanel';
import ImSettingsPanel from './im/ImSettingsPanel';
import { ManagedMemorySettings } from './memory/ManagedMemorySettings';
import ModelSettingsPanel from './model/ModelSettingsPanel';
import ShortcutsSettingsPanel from './shortcuts/ShortcutsSettingsPanel';
import {
  fromEnterpriseTab,
  isEnterpriseTab,
  type SettingsPageProps,
  type SettingsTabType,
} from './types';
import {
  settingsContentWidthClass,
  settingsFooterMode,
  settingsFooterSecondaryLabel,
  type SettingsFooterMode,
} from './constants';
import { useSettingsTabs } from './useSettingsTabs';

export default function SettingsPage({
  onClose,
  initialTab,
  initialProvider: _initialProvider,
  notice,
  noticeI18nKey,
  noticeExtra,
  enterpriseConfig,
  appUpdateState,
  managedModelsOnly = false,
  inferenceEdition: _inferenceEdition,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
}: SettingsPageProps) {
  // 状态
  const [requestedActiveTab, setActiveTab] = useState<SettingsTabType>(initialTab ?? 'general');
  const [enterpriseSettingsPages, setEnterpriseSettingsPages] = useState<
    readonly EnterpriseRendererSettingsPage[]
  >([]);
  const activeTab = requestedActiveTab;
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [language, setLanguage] = useState<LanguageType>('zh');
  const [useSystemProxy, setUseSystemProxy] = useState(false);
  const [sqliteAutoBackupEnabled, setSqliteAutoBackupEnabled] = useState(false);
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [preventSleep, setPreventSleep] = useState(false);
  const [codemodeEnabled, setCodemodeEnabled] = useState(false);
  const [mcpNativeBridge, setMcpNativeBridge] = useState(false);
  const initialGeneralRef = useRef({
    autoLaunch: false,
    preventSleep: false,
    codemodeEnabled: false,
    mcpNativeBridge: false,
  });
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
    let active = true;
    void (async () => {
      const [autoLaunchResult, preventSleepResult, coworkConfigResult] = await Promise.all([
        window.electron.autoLaunch.get().catch(() => null),
        window.electron.preventSleep.get().catch(() => null),
        window.electron.cowork.getConfig().catch(() => null),
      ]);
      if (!active) return;
      const next = {
        autoLaunch: autoLaunchResult?.enabled === true,
        preventSleep: preventSleepResult?.enabled === true,
        codemodeEnabled: coworkConfigResult?.config?.codemodeEnabled === true,
        mcpNativeBridge: coworkConfigResult?.config?.mcpNativeBridge === true,
      };
      initialGeneralRef.current = next;
      setAutoLaunch(next.autoLaunch);
      setPreventSleep(next.preventSleep);
      setCodemodeEnabled(next.codemodeEnabled);
      setMcpNativeBridge(next.mcpNativeBridge);
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
    if (settingsFooterMode(activeTab) === 'close') {
      onClose();
      return;
    }
    setIsSaving(true);
    setError(null);
    let appConfigSaved = false;

    try {
      const emailSaved = (await emailSettingsRef.current?.saveIfDirty()) ?? true;
      if (!emailSaved) {
        setActiveTab('email');
        return;
      }

      const currentAppConfig = configService.getConfig();
      const appConfigPatch = buildAppSettingsSavePatch({
        current: currentAppConfig,
        theme,
        themeStyle,
        language,
        useSystemProxy,
        sqliteAutoBackupEnabled,
        shortcuts,
      });
      if (Object.keys(appConfigPatch).length > 0) {
        await configService.updateConfig(appConfigPatch);
        appConfigSaved = true;
      }

      const initialGeneral = initialGeneralRef.current;
      if (autoLaunch !== initialGeneral.autoLaunch) {
        const result = await window.electron.autoLaunch.set(autoLaunch);
        if (!result.success) {
          throw new Error(result.error || i18nService.t('autoLaunchUpdateFailed'));
        }
        appConfigSaved = true;
      }
      if (preventSleep !== initialGeneral.preventSleep) {
        const result = await window.electron.preventSleep.set(preventSleep);
        if (!result.success) {
          throw new Error(result.error || i18nService.t('preventSleepUpdateFailed'));
        }
        appConfigSaved = true;
      }
      if (
        codemodeEnabled !== initialGeneral.codemodeEnabled ||
        mcpNativeBridge !== initialGeneral.mcpNativeBridge
      ) {
        const updated = await coworkService.updateConfig({ codemodeEnabled, mcpNativeBridge });
        if (!updated) {
          throw new Error(i18nService.t('coworkConfigSaveFailed'));
        }
        appConfigSaved = true;
      }
      initialGeneralRef.current = { autoLaunch, preventSleep, codemodeEnabled, mcpNativeBridge };

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
  const contentWidthClass = settingsContentWidthClass(activeTab);
  const footerMode: SettingsFooterMode = settingsFooterMode(activeTab);
  const footerSecondaryLabel = settingsFooterSecondaryLabel(activeTab);

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
            autoLaunch={autoLaunch}
            onAutoLaunchChange={setAutoLaunch}
            preventSleep={preventSleep}
            onPreventSleepChange={setPreventSleep}
            useSystemProxy={useSystemProxy}
            onUseSystemProxyChange={next => setUseSystemProxy(next)}
            sqliteAutoBackupEnabled={sqliteAutoBackupEnabled}
            onSqliteAutoBackupEnabledChange={next => setSqliteAutoBackupEnabled(next)}
            codemodeEnabled={codemodeEnabled}
            onCodemodeEnabledChange={setCodemodeEnabled}
            mcpNativeBridge={mcpNativeBridge}
            onMcpNativeBridgeChange={setMcpNativeBridge}
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

      case 'aisphere':
        return <AISphereSettings />;

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

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Category sidebar; wraps into a tab strip when the window is narrow. */}
        <nav
          aria-label={i18nService.t('settings')}
          className="theme-shell-sidebar flex w-full shrink-0 flex-wrap items-center gap-1 px-2 py-2 lg:w-[220px] lg:flex-col lg:items-stretch lg:gap-4 lg:overflow-x-hidden lg:overflow-y-auto lg:px-2 lg:py-4"
        >
          {navGroups.map((group, groupIndex) => (
            <div
              key={group.title ?? groupIndex}
              className="flex shrink-0 flex-row flex-wrap gap-1 lg:w-full lg:flex-col lg:gap-1"
            >
              {group.title ? (
                <div className="theme-shell-sidebar-section hidden items-center lg:flex">
                  {group.title}
                </div>
              ) : null}
              {group.tabs.map(tab => (
                <div key={tab.key} className="shrink-0 lg:w-full">
                  <Button
                    type="button"
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
                </div>
              ))}
            </div>
          ))}
        </nav>

        {/* Right content */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {noticeMessage && (
            <div className="px-4 pt-4 sm:px-6">
              <div className={cn('w-full', contentWidthClass)}>
                <ErrorMessage message={noticeMessage} onClose={() => setNoticeMessage(null)} />
              </div>
            </div>
          )}

          {error && (
            <div className="px-4 pt-4 sm:px-6">
              <div className={cn('w-full', contentWidthClass)}>
                <ErrorMessage message={error} onClose={() => setError(null)} />
              </div>
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
              role="region"
              aria-label={activeTabLabel}
              tabIndex={0}
              className={cn(
                'flex-1',
                isEnterpriseTab(activeTab)
                  ? 'overflow-hidden'
                  : 'overflow-y-auto px-4 py-6 sm:px-6',
              )}
              style={{ scrollbarGutter: 'stable' }}
            >
              <div
                className={cn(
                  'w-full min-w-0',
                  contentWidthClass,
                  activeTab === 'email' ? 'block' : 'hidden',
                )}
              >
                <EmailSettingsPage ref={emailSettingsRef} />
              </div>
              <div
                className={cn(
                  'w-full min-w-0',
                  contentWidthClass,
                  activeTab === 'model' ? 'block h-full' : 'hidden',
                )}
              >
                {activeTab === 'model' && <ModelSettingsPanel />}
              </div>
              {activeTab !== 'email' && activeTab !== 'model' && (
                <div
                  className={cn(
                    'w-full min-w-0',
                    !isEnterpriseTab(activeTab) && contentWidthClass,
                    activeTab === 'im' && 'h-full',
                  )}
                >
                  {renderTabContent()}
                </div>
              )}
            </div>

            {/* Footer buttons */}
            {!isEnterpriseTab(activeTab) && (
              <div className="shrink-0 border-t border-border bg-background">
                <div
                  className={cn(
                    'flex flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6',
                    contentWidthClass,
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className="theme-confirm-cancel min-w-16"
                    onClick={onClose}
                    disabled={isSaving}
                  >
                    {i18nService.t(footerSecondaryLabel)}
                  </Button>
                  {footerMode === 'draft' && (
                    <Button
                      type="submit"
                      variant="default"
                      className={localInferenceCompactButtonClass}
                      disabled={isSaving}
                    >
                      {isSaving ? i18nService.t('saving') : i18nService.t('save')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
