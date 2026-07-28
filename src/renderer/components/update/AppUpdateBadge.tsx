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
      ? i18nService.t('updateReadyPill')
      : status === AppUpdateStatus.Downloading
        ? i18nService.t('updateDownloadingPill')
        : status === AppUpdateStatus.Error
          ? i18nService.t('updateErrorPill')
          : i18nService.t('updateAvailablePill');

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="non-draggable flex h-8 w-full items-center justify-start gap-2 rounded-md px-1.5 text-[14px] font-normal text-primary hover:bg-primary/10"
      title={`${label} ${latestVersion}`}
      aria-label={`${label} ${latestVersion}`}
    >
      {status === AppUpdateStatus.Downloading ? <Download className="h-4 w-4 shrink-0" /> : <ArrowUpCircle className="h-4 w-4 shrink-0" />}
      <span className="truncate">{label} v{latestVersion}</span>
    </Button>
  );
};

export default AppUpdateBadge;
