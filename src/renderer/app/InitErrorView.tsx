import { Button } from '@shared/components/ui/button';
import { MessageCircle } from 'lucide-react';
import React from 'react';

import { type AppUpdateRuntimeState } from '../../shared/appUpdate/constants';
import { LazyChunkErrorBoundary } from '../components/LazyChunkErrorBoundary';
import type { SettingsEnterpriseConfig, SettingsOpenOptions } from '../components/settings/types';
import { i18nService } from '../services/i18n';
import { SettingsPage } from './lazyViews';

interface InitErrorViewProps {
  initError: string;
  /** Windows standalone title bar rendered above the fallback content. */
  titleBar: React.ReactNode;
  isSettingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  settingsOptions: SettingsOpenOptions;
  enterpriseConfig: SettingsEnterpriseConfig | null;
  appUpdateState: AppUpdateRuntimeState;
  managedModelsOnly: boolean;
}

/**
 * Full-screen fallback for a failed bootstrap. Offers restart plus an escape
 * hatch into settings (e.g. to fix a broken provider configuration).
 */
export function InitErrorView({
  initError,
  titleBar,
  isSettingsOpen,
  onOpenSettings,
  onCloseSettings,
  settingsOptions,
  enterpriseConfig,
  appUpdateState,
  managedModelsOnly,
}: InitErrorViewProps) {
  return (
    <div className="h-screen overflow-hidden flex flex-col">
      {titleBar}
      {isSettingsOpen ? (
        <div className="flex-1 flex min-h-0">
          <LazyChunkErrorBoundary>
            <React.Suspense fallback={null}>
              <SettingsPage
                onClose={onCloseSettings}
                initialTab={settingsOptions.initialTab}
                initialProvider={settingsOptions.initialProvider}
                notice={settingsOptions.notice}
                enterpriseConfig={enterpriseConfig}
                appUpdateState={appUpdateState}
                managedModelsOnly={managedModelsOnly}
              />
            </React.Suspense>
          </LazyChunkErrorBoundary>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-background">
          <div className="flex flex-col items-center space-y-6 max-w-md px-6">
            <div className="w-16 h-16 rounded-full bg-destructive flex items-center justify-center shadow-lg">
              <MessageCircle className="h-8 w-8 text-destructive-foreground" />
            </div>
            <div className="text-foreground text-xl font-medium text-center">{initError}</div>
            <div className="flex items-center gap-3">
              <Button onClick={() => window.electron.appInfo.relaunch()}>
                {i18nService.t('restartApp')}
              </Button>
              <Button variant="outline" onClick={onOpenSettings}>
                {i18nService.t('openSettings')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
