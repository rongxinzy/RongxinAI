import { Button } from '@shared/components/ui/button';
import { ArrowUpCircle, Download } from 'lucide-react';
import React from 'react';

import {
  AppUpdateStatus,
  type AppUpdateStatus as AppUpdateStatusValue,
} from '../../../shared/appUpdate/constants';
import { i18nService } from '../../services/i18n';

interface AppUpdateBadgeProps {
  latestVersion: string;
  status: AppUpdateStatusValue;
  onClick: () => void;
}

const AppUpdateBadge: React.FC<AppUpdateBadgeProps> = ({ latestVersion, status, onClick }) => {
  const label =
    status === AppUpdateStatus.Ready
      ? i18nService.t('updateReadyConfirm')
      : status === AppUpdateStatus.Available
        ? i18nService.t('updateOpenDownloadPage')
        : i18nService.t('updateErrorPill');

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="theme-page-app-update-badge-button-1 non-draggable flex w-full items-center justify-start"
      title={`${label} ${latestVersion}`}
      aria-label={`${label} ${latestVersion}`}
    >
      {status === AppUpdateStatus.Error || status === AppUpdateStatus.Available ? (
        <Download className="h-4 w-4 shrink-0" />
      ) : (
        <ArrowUpCircle className="h-4 w-4 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </Button>
  );
};

export default AppUpdateBadge;
