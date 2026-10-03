import { cn } from '@shared/lib/utils';
import { Terminal, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { i18nService } from '../../services/i18n';
import { PermissionDangerLevel } from './permissionDanger';

const DANGER_BANNER_LEVEL_CLASS = {
  destructive: 'theme-permission-danger-banner-destructive',
  caution: 'theme-permission-danger-banner-warning',
} as const;

const DANGER_BANNER_TITLE_KEY = {
  destructive: 'coworkDestructiveOperation',
  caution: 'coworkCautionOperation',
} as const;

interface PermissionDangerBannerProps {
  level: PermissionDangerLevel;
  reasonText: string;
}

/**
 * Shared risk banner for inline permission cards. Geometry and colors come from
 * the theme `permission-danger-banner*` hooks, so every theme and mode renders
 * the same structure with its own palette.
 */
export const PermissionDangerBanner = ({ level, reasonText }: PermissionDangerBannerProps) => {
  if (level === PermissionDangerLevel.Safe) return null;
  return (
    <div
      className={cn(
        'theme-permission-danger-banner flex items-start gap-2 mx-5 my-4',
        DANGER_BANNER_LEVEL_CLASS[level],
      )}
    >
      <TriangleAlert className="size-4 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium">{i18nService.t(DANGER_BANNER_TITLE_KEY[level])}</p>
        {reasonText && <p className="text-xs mt-0.5">{reasonText}</p>}
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
        <Terminal className="size-3.5" />
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
  /** Optional header row: icon, title and trailing slot (e.g. a status badge). */
  header?: ReactNode;
  /** Scrollable card body. */
  children: ReactNode;
  /** Actions rendered in the card footer, right aligned. */
  footer: ReactNode;
  dangerLevel?: PermissionDangerLevel;
  dangerReasonText?: string;
  /** Layout-only classes (margin, width) for the card shell. */
  className?: string;
}

/**
 * Shared inline surface for cards that ask the user something inside the
 * conversation flow: tool approvals, question prompts and task acceptance.
 * Optional header slot, scrollable body, optional risk banner, footer slot.
 */
export const PermissionRequestCard = ({
  header,
  children,
  footer,
  dangerLevel = PermissionDangerLevel.Safe,
  dangerReasonText = '',
  className,
}: PermissionRequestCardProps) => (
  <div className={cn('theme-permission-inline-surface w-full overflow-hidden', className)}>
    {header ? (
      <div className="flex items-center gap-2 px-5 pt-4 text-sm font-medium text-foreground">
        {header}
      </div>
    ) : null}
    <div className="px-5 py-4 space-y-4 max-h-[42vh] overflow-y-auto">{children}</div>
    <PermissionDangerBanner level={dangerLevel} reasonText={dangerReasonText} />
    <div className="flex items-center justify-end gap-3 px-5 py-3">{footer}</div>
  </div>
);
