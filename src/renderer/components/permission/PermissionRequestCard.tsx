import { cn } from '@shared/lib/utils';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { i18nService } from '../../services/i18n';
import { PermissionDangerLevel } from './permissionDanger';

const DANGER_BANNER_STYLES = {
  destructive: {
    surface: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    icon: 'text-red-500',
    title: 'text-red-700 dark:text-red-400',
    reason: 'text-red-600 dark:text-red-500',
    titleKey: 'coworkDestructiveOperation',
  },
  caution: {
    surface: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    icon: 'text-yellow-500',
    title: 'text-yellow-700 dark:text-yellow-400',
    reason: 'text-yellow-600 dark:text-yellow-500',
    titleKey: 'coworkCautionOperation',
  },
} as const;

interface PermissionDangerBannerProps {
  level: PermissionDangerLevel;
  reasonText: string;
}

/**
 * Shared risk banner for inline permission cards. The palette classes are the
 * ones the work-mode permission card has always used, so both surfaces stay
 * pixel-identical in every theme.
 */
export const PermissionDangerBanner = ({ level, reasonText }: PermissionDangerBannerProps) => {
  if (level === PermissionDangerLevel.Safe) return null;
  const styles = DANGER_BANNER_STYLES[level];
  return (
    <div className={cn('flex items-start gap-2 p-3 mx-6 my-4 rounded-lg border', styles.surface)}>
      <TriangleAlert className={cn('h-5 w-5 shrink-0 mt-0.5', styles.icon)} />
      <div>
        <p className={cn('text-sm font-medium', styles.title)}>{i18nService.t(styles.titleKey)}</p>
        {reasonText && <p className={cn('text-xs mt-0.5', styles.reason)}>{reasonText}</p>}
      </div>
    </div>
  );
};

interface PermissionToolBodyProps {
  /** Tool name, or a localized fallback while the agent omits one. */
  title: string;
  /** Command text or formatted tool input rendered as a monospace block. */
  detail: string;
}

/** Badge + tool name + monospace detail block shared by both permission cards. */
export const PermissionToolBody = ({ title, detail }: PermissionToolBodyProps) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-background border border-border">
        <code className="text-xs">&gt;_</code>
      </span>
      <span>{title}</span>
    </div>
    {detail ? (
      <div className="rounded-xl bg-background px-3 py-2.5">
        <pre className="text-xs text-foreground whitespace-pre-wrap wrap-break-word font-mono max-h-24 overflow-y-auto">
          {detail}
        </pre>
      </div>
    ) : null}
  </div>
);

interface PermissionRequestCardProps {
  /** Scrollable card body. */
  children: ReactNode;
  /** Actions rendered in the card footer, right aligned. */
  footer: ReactNode;
  dangerLevel?: PermissionDangerLevel;
  dangerReasonText?: string;
}

/**
 * Inline permission surface shared by work mode and coding mode: a scrollable
 * body slot, the optional risk banner and a footer slot.
 */
export const PermissionRequestCard = ({
  children,
  footer,
  dangerLevel = PermissionDangerLevel.Safe,
  dangerReasonText = '',
}: PermissionRequestCardProps) => (
  <div className="theme-permission-inline-surface w-full overflow-hidden">
    <div className="px-5 py-4 space-y-4 max-h-[42vh] overflow-y-auto">{children}</div>
    <PermissionDangerBanner level={dangerLevel} reasonText={dangerReasonText} />
    <div className="flex items-center justify-end gap-3 px-5 py-3">{footer}</div>
  </div>
);
