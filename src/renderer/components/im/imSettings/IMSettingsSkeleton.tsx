/**
 * Loading skeleton for the IM settings view, shown before the IM service has
 * finished initializing. Extracted verbatim from IMSettings.tsx (issue #1069).
 */
import { Skeleton } from '@shared/components/ui/skeleton';
import React from 'react';

import { i18nService } from '../../../services/i18n';

export const IMSettingsSkeleton: React.FC = () => (
  <div
    className="flex h-full min-h-0 gap-4"
    aria-label={i18nService.t('imLoadingBots')}
    aria-busy="true"
  >
    <div className="flex w-48 shrink-0 flex-col gap-2 border-r border-border pr-3">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
    <div className="flex flex-1 flex-col gap-4 px-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-32" />
    </div>
  </div>
);
