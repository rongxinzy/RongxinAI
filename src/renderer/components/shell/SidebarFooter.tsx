import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { Settings, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { i18nService } from '../../services/i18n';
import { showAppError } from '../../services/appToast';
import { WorkMode } from '../../store/workMode/constants';
import type { PrefetchableFeatureView } from '../featureViewPrefetch';
import LoginButton from '../LoginButton';
import type { SidebarActiveView } from '../SidebarNavigationControls';

interface SidebarFooterProps {
  activeView: SidebarActiveView;
  workMode: WorkMode;
  isBatchMode: boolean;
  selectedIds: ReadonlySet<string>;
  visibleSessionIds: readonly string[];
  showBatchDeleteConfirm: boolean;
  onSelectAll: () => void;
  onBatchDeleteClick: () => void;
  onBatchDelete: () => Promise<void>;
  onExitBatchMode: () => void;
  onCancelBatchDelete: () => void;
  updateEntry?: ReactNode;
  hideLogin?: boolean;
  onShowSettings: () => void;
  onPrefetchView?: (view: PrefetchableFeatureView) => void;
}

export function SidebarFooter({
  activeView,
  workMode,
  isBatchMode,
  selectedIds,
  visibleSessionIds,
  showBatchDeleteConfirm,
  onSelectAll,
  onBatchDeleteClick,
  onBatchDelete,
  onExitBatchMode,
  onCancelBatchDelete,
  updateEntry,
  hideLogin,
  onShowSettings,
  onPrefetchView,
}: SidebarFooterProps) {
  const showSettings = () => {
    onPrefetchView?.('settings');
    onShowSettings();
  };
  return (
    <>
      {isBatchMode && activeView !== 'coding' ? (
        <div className="theme-sidebar-footer flex items-center justify-between">
          <label className="flex items-center justify-start gap-2 cursor-pointer text-sm text-muted-foreground">
            <Checkbox
              checked={
                visibleSessionIds.length > 0 && visibleSessionIds.every(id => selectedIds.has(id))
              }
              onCheckedChange={onSelectAll}
            />
            {i18nService.t('batchSelectAll')}
          </label>
          <div className="flex items-center justify-start gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onBatchDeleteClick}
              disabled={selectedIds.size === 0}
              className="theme-page-sidebar-button-1 inline-flex items-center"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {selectedIds.size > 0 ? `${selectedIds.size}` : ''}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onExitBatchMode}
              className="theme-page-sidebar-button-2"
            >
              {i18nService.t('batchCancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="theme-sidebar-footer space-y-1">
          {updateEntry}
          {!hideLogin ? (
            <LoginButton settingsActive={activeView === 'settings'} onShowSettings={showSettings} />
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={showSettings}
              data-active={activeView === 'settings' || undefined}
              aria-current={activeView === 'settings' ? 'page' : undefined}
              className="theme-action-row w-full justify-start gap-2"
            >
              <Settings data-icon="inline-start" />
              <span>{i18nService.t('settings')}</span>
            </Button>
          )}
        </div>
      )}
      <DestructiveConfirmDialog
        open={showBatchDeleteConfirm}
        title={i18nService.t('batchDeleteConfirmTitle')}
        description={[
          i18nService.t('batchDeleteConfirmMessage').replace('{count}', String(selectedIds.size)),
          workMode === WorkMode.Work
            ? i18nService.t('scheduledTasksBatchDeleteConversationNotice')
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={`${i18nService.t('batchDelete')} (${selectedIds.size})`}
        onCancel={onCancelBatchDelete}
        onConfirm={() => {
          void onBatchDelete().catch(error => {
            showAppError(error);
          });
        }}
      />
    </>
  );
}
