import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import React from 'react';

import { i18nService } from '../services/i18n';
import { SidebarAnimatedMessageCirclePlusIcon } from './icons/SidebarAnimatedMessageCirclePlusIcon';
import { SidebarAnimatedPanelLeftCloseIcon } from './icons/SidebarAnimatedPanelLeftCloseIcon';
import WindowTitleBar from './window/WindowTitleBar';

/**
 * Shared top bar for every sidebar-switched page. All feature views must use
 * this component instead of hand-rolling a header, so height, padding, drag
 * region, border, collapse buttons, macOS traffic-light padding, and the
 * window controls stay identical across pages.
 *
 * Conventions:
 * - Page title lives here (`title`), never duplicated in a content hero.
 * - `tabs` renders a second row that carries the border-b divider; pass a
 *   PageTabs element for feature-page tabs.
 */
interface PageHeaderProps {
  /** Page title rendered as the standard h1 (text-lg font-semibold). */
  title?: string;
  /** Fully custom left cluster; replaces the title (e.g. Coding workspace). */
  leftContent?: React.ReactNode;
  /** Right-side controls rendered before the window title bar. */
  actions?: React.ReactNode;
  /** Second row (tabs); takes over the border-b divider from the main row. */
  tabs?: React.ReactNode;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  leftContent,
  actions,
  tabs,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const isMac = window.electron.platform === 'darwin';
  return (
    <header className="shrink-0 bg-background">
      <div
        className={cn(
          'draggable flex h-12 items-center justify-between gap-3 px-4',
          !tabs && 'border-b border-border-subtle',
        )}
      >
        <div className="flex h-8 min-w-0 items-center gap-3">
          {isSidebarCollapsed && (
            <div className={cn('non-draggable flex items-center gap-1', isMac && 'pl-[68px]')}>
              {onToggleSidebar && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onToggleSidebar}
                  aria-label={i18nService.t('expand')}
                  title={i18nService.t('expand')}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                >
                  <SidebarAnimatedPanelLeftCloseIcon direction="right" />
                </Button>
              )}
              {onNewChat && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onNewChat}
                  aria-label={i18nService.t('newChat')}
                  title={i18nService.t('newChat')}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                >
                  <SidebarAnimatedMessageCirclePlusIcon />
                </Button>
              )}
              {updateBadge}
            </div>
          )}
          {leftContent ??
            (title ? (
              <h1 className="truncate text-lg font-semibold text-foreground">{title}</h1>
            ) : null)}
        </div>
        <div className="non-draggable flex shrink-0 items-center gap-1">
          {actions}
          <WindowTitleBar inline />
        </div>
      </div>
      {tabs ? <div className="non-draggable border-b border-border-subtle px-4">{tabs}</div> : null}
    </header>
  );
};

export default PageHeader;
