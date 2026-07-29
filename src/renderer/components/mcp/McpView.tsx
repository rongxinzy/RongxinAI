import { Button } from '@shared/components/ui/button';
import { PanelLeft, Pencil } from 'lucide-react';
import React from 'react';

import { i18nService } from '../../services/i18n';
import WindowTitleBar from '../window/WindowTitleBar';
import McpManager from './McpManager';
import type { McpRegistryId } from './constants';

interface McpViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  onUseMcp?: (prompt?: string) => void;
  updateBadge?: React.ReactNode;
  openRegistryId?: McpRegistryId;
  openMarketplace?: boolean;
}

const McpView: React.FC<McpViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  onUseMcp,
  updateBadge,
  openRegistryId,
  openMarketplace,
}) => {
  const isMac = window.electron.platform === 'darwin';
  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      <div className="draggable flex h-12 items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center space-x-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onToggleSidebar}
                className="h-8 w-8"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onNewChat}
                className="h-8 w-8"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {updateBadge}
            </div>
          )}
          <h1 className="text-lg font-semibold text-foreground">{i18nService.t('connectors')}</h1>
        </div>
        <WindowTitleBar inline />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-gutter-stable">
        <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6">
          <McpManager
            onUseMcp={onUseMcp}
            openRegistryId={openRegistryId}
            openMarketplace={openMarketplace}
          />
        </div>
      </div>
    </div>
  );
};

export default McpView;
