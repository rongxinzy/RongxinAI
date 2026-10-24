import { cn } from '@shared/lib/utils';
import React from 'react';

import { i18nService } from '../services/i18n';
import { SidebarAnimatedMessageCirclePlusIcon } from './icons/SidebarAnimatedMessageCirclePlusIcon';
import { SidebarAnimatedPanelLeftCloseIcon } from './icons/SidebarAnimatedPanelLeftCloseIcon';
import WindowTitleBar from './window/WindowTitleBar';
import { PageHeaderLayout } from './shell/PageHeaderLayout';
import { ShellIconButton } from './shell/ShellIconButton';

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
  /** Whether a divider separates the header from the content below. */
  divider?: boolean;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  /** Standalone windows can supply their own native chrome or use the OS frame. */
  windowControls?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  leftContent,
  actions,
  tabs,
  divider,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  windowControls,
}) => {
  const isMac = window.electron?.platform === 'darwin';
  return (
    <PageHeaderLayout
      navigation={
        isSidebarCollapsed ? (
          <div
            className={cn('non-draggable flex shrink-0 items-center gap-1', isMac && 'pl-[68px]')}
          >
            {onToggleSidebar && (
              <ShellIconButton onClick={onToggleSidebar} label={i18nService.t('expand')}>
                <SidebarAnimatedPanelLeftCloseIcon direction="right" />
              </ShellIconButton>
            )}
            {onNewChat && (
              <ShellIconButton onClick={onNewChat} label={i18nService.t('newChat')}>
                <SidebarAnimatedMessageCirclePlusIcon />
              </ShellIconButton>
            )}
            {updateBadge}
          </div>
        ) : null
      }
      content={
        leftContent ??
        (title ? (
          <h1 className="theme-heading truncate text-sm font-medium text-foreground">{title}</h1>
        ) : null)
      }
      actions={actions}
      windowControls={windowControls === undefined ? <WindowTitleBar inline /> : windowControls}
      tabs={tabs}
      divider={divider}
    />
  );
};

export default PageHeader;
