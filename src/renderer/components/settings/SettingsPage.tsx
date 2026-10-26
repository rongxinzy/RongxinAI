import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { COMPANION_SHORTCUT } from '../../../shared/companion/constants';
import type { EnterpriseRendererSettingsPage } from '../../../shared/enterpriseRenderer';
import { defaultConfig, type AppConfig } from '../../config';
import { configService } from '../../services/config';
import { coworkService } from '../../services/cowork';
import { i18nService, type LanguageType } from '../../services/i18n';
import { formatShortcutLabel } from '../../services/shortcutLabel';
import { shortcutsConflict } from '../../services/shortcuts';
import { themeService } from '../../services/theme';
import { showAppToast } from '../../services/toastNotification';
import { selectCoworkConfig } from '../../store/selectors/coworkSelectors';
import ErrorMessage from '../ErrorMessage';
import { EnterpriseSettingsPage } from '../enterprise/EnterpriseSettingsPage';
import PageHeader from '../PageHeader';
import AboutSettingsPanel from './about/AboutSettingsPanel';
import { AISphereSettings } from './AISphereSettings';
import { AppearanceSettingsPanel } from './appearance/AppearanceSettingsPanel';
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
import { settingsContentWidthClass } from './constants';
import { useSettingsTabs } from './useSettingsTabs';

export default function SettingsPage({
  onClose,
  initialTab,
  initialProvider: _initialProvider,
  notice,
  noticeI18nKey,
  noticeExtra,
  enterpriseConfig,
  managedModelsOnly = false,
  inferenceEdition: _inferenceEdition,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
}: SettingsPageProps) {
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
  const [error, setError] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(() => {
    if (noticeI18nKey) {
      const base = i18nService.t(noticeI18nKey);
      return noticeExtra ? `${base} (${noticeExtra})` : base;
    }
    return notice ?? null;
  });
  const [themeStyle, setThemeStyle] = useState(themeService.getStyle());
  const contentRef = useRef<HTMLDivElement>(null);
  const [shortcuts, setShortcuts] = useState({
    ...defaultConfig.shortcuts!,
  });
  const coworkConfig = useSelector(selectCoworkConfig);

  const buildNoticeMessage = useCallback((): string | null => {
    if (noticeI18nKey) {
      const base = i18nService.t(noticeI18nKey);
      return noticeExtra ? `${base} (${noticeExtra})` : base;
    }
    return notice ?? null;
  }, [notice, noticeExtra, noticeI18nKey]);

  const persistConfig = useCallback(async (patch: Partial<AppConfig>) => {
    try {
      await configService.updateConfig(patch);
    } catch {
      setError(i18nService.t('settingsSaveFailed'));
    }
  }, []);

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

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const config = await configService.reload();
        if (!active) return;
        setTheme(config.theme);
        setThemeStyle(themeService.getStyle());
        setLanguage(config.language);
        setUseSystemProxy(config.useSystemProxy ?? false);
        setSqliteAutoBackupEnabled(config.sqliteAutoBackupEnabled === true);
        if (config.shortcuts) {
          setShortcuts(previous => ({ ...previous, ...config.shortcuts }));
        }
      } catch {
        if (active) setError(i18nService.t('settingsLoadFailed'));
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
      setAutoLaunch(autoLaunchResult?.enabled === true);
      setPreventSleep(preventSleepResult?.enabled === true);
      setCodemodeEnabled(coworkConfigResult?.config?.codemodeEnabled === true);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab]);

  useEffect(() => {
    setNoticeMessage(buildNoticeMessage());
  }, [buildNoticeMessage]);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const unsubscribe = i18nService.subscribe(() => {
      setLanguage(i18nService.getLanguage());
      if (noticeI18nKey) {
        const base = i18nService.t(noticeI18nKey);
        setNoticeMessage(noticeExtra ? `${base} (${noticeExtra})` : base);
      }
    });
    return unsubscribe;
  }, [noticeI18nKey, noticeExtra]);

  const handleTabChange = (tab: SettingsTabType) => setActiveTab(tab);

  const handleLanguageChange = (next: LanguageType) => {
    setLanguage(next);
    i18nService.setLanguage(next);
  };

  const handleThemeChange = (next: 'light' | 'dark' | 'system') => {
    setTheme(next);
    themeService.setTheme(next);
    void persistConfig({ theme: next });
  };

  const handleStyleChange = (id: string) => {
    setThemeStyle(id);
    themeService.setStyle(id);
    void persistConfig({ themeStyle: id });
  };

  const handleAutoLaunchChange = async (next: boolean) => {
    const previous = autoLaunch;
    setAutoLaunch(next);
    const result = await window.electron.autoLaunch.set(next).catch(() => null);
    if (!result?.success) {
      setAutoLaunch(previous);
      setError(result?.error || i18nService.t('autoLaunchUpdateFailed'));
    }
  };

  const handlePreventSleepChange = async (next: boolean) => {
    const previous = preventSleep;
    setPreventSleep(next);
    const result = await window.electron.preventSleep.set(next).catch(() => null);
    if (!result?.success) {
      setPreventSleep(previous);
      setError(result?.error || i18nService.t('preventSleepUpdateFailed'));
    }
  };

  const handleCodemodeChange = async (next: boolean) => {
    setCodemodeEnabled(next);
    const updated = await coworkService.updateConfig({ codemodeEnabled: next });
    if (!updated) {
      setCodemodeEnabled(!next);
      setError(i18nService.t('coworkConfigSaveFailed'));
    }
  };

  const shortcutLabelMap: Record<string, string> = {
    newChat: 'newChat',
    search: 'search',
    settings: 'openSettings',
    sendMessage: 'sendMessageShortcut',
  };

  const handleShortcutChange = (key: keyof typeof shortcuts, value: string) => {
    const isMacPlatform = navigator.platform.includes('Mac');
    const conflictKey =
      value &&
      Object.keys(shortcuts).find(
        candidate =>
          candidate !== key &&
          shortcutsConflict(shortcuts[candidate as keyof typeof shortcuts], value, isMacPlatform),
      );
    const conflictLabel = shortcutsConflict(COMPANION_SHORTCUT, value, isMacPlatform)
      ? i18nService.t('companionShortcutLabel')
      : conflictKey
        ? i18nService.t(shortcutLabelMap[conflictKey] ?? conflictKey)
        : null;
    if (conflictLabel) {
      showAppToast({
        message: i18nService
          .t('shortcutConflict')
          .replace('{0}', formatShortcutLabel(value, isMacPlatform))
          .replace('{1}', conflictLabel),
        isError: false,
      });
      return;
    }
    const next = { ...shortcuts, [key]: value };
    setShortcuts(next);
    void configService.updateConfig({ shortcuts: next }).catch(() => {
      setError(i18nService.t('settingsSaveFailed'));
    });
  };

  const { groups: navGroups, tabs: sidebarTabs } = useSettingsTabs({
    enterpriseSettingsPages,
    language,
    enterpriseConfig,
    managedModelsOnly,
  });

  const activeTabLabel = useMemo(
    () => sidebarTabs.find(tab => tab.key === activeTab)?.label ?? '',
    [activeTab, sidebarTabs],
  );
  const contentWidthClass = settingsContentWidthClass(activeTab);

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
            onLanguageChange={handleLanguageChange}
            autoLaunch={autoLaunch}
            onAutoLaunchChange={next => void handleAutoLaunchChange(next)}
            preventSleep={preventSleep}
            onPreventSleepChange={next => void handlePreventSleepChange(next)}
            useSystemProxy={useSystemProxy}
            onUseSystemProxyChange={next => {
              setUseSystemProxy(next);
              void persistConfig({ useSystemProxy: next });
            }}
            sqliteAutoBackupEnabled={sqliteAutoBackupEnabled}
            onSqliteAutoBackupEnabledChange={next => {
              setSqliteAutoBackupEnabled(next);
              void persistConfig({ sqliteAutoBackupEnabled: next });
            }}
            codemodeEnabled={codemodeEnabled}
            onCodemodeEnabledChange={next => void handleCodemodeChange(next)}
          />
        );

      case 'appearance':
        return (
          <AppearanceSettingsPanel
            appearance={theme}
            styleId={themeStyle}
            onAppearanceChange={handleThemeChange}
            onStyleChange={handleStyleChange}
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
        return <AboutSettingsPanel setError={setError} setNoticeMessage={setNoticeMessage} />;

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

          <div className="flex flex-col flex-1 overflow-hidden">
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
                <EmailSettingsPage />
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
                  >
                    {i18nService.t('close')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
