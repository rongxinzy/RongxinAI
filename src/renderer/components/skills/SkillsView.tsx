import React, { useRef } from 'react';

import { i18nService } from '../../services/i18n';
import PageHeader from '../PageHeader';
import SkillsManager from './SkillsManager';

interface SkillsViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  onCreateSkillByChat?: () => void;
  onTrySkill?: (skillId: string) => void;
  updateBadge?: React.ReactNode;
  readOnly?: boolean;
}

const SkillsView: React.FC<SkillsViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  onCreateSkillByChat,
  onTrySkill,
  updateBadge,
  readOnly,
}) => {
  const detailContainerRef = useRef<HTMLDivElement>(null);
  return (
    <div data-page-canvas className="flex-1 flex flex-col bg-background h-full">
      <PageHeader
        title={i18nService.t('skills')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
      />

      <div ref={detailContainerRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-4 sm:px-6">
          <SkillsManager
            readOnly={readOnly}
            onCreateByChat={onCreateSkillByChat}
            onTrySkill={onTrySkill}
            detailContainerRef={detailContainerRef}
          />
        </div>
      </div>
    </div>
  );
};

export default SkillsView;
