import React from 'react';

import { i18nService } from '../../services/i18n';
import PageHeader from '../PageHeader';
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
  return (
    <div data-page-canvas className="flex-1 flex flex-col bg-background h-full">
      <PageHeader
        title={i18nService.t('connectors')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
      />

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
