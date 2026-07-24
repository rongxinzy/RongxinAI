import { Button } from '@shared/components/ui/button';
import { PanelLeft, Pencil } from 'lucide-react';
import React, { useRef } from 'react';

import { i18nService } from '../../services/i18n';
import WindowTitleBar from '../window/WindowTitleBar';
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
  const isMac = window.electron.platform === 'darwin';
  const detailContainerRef = useRef<HTMLDivElement>(null);
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
                className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-surface-raised"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onNewChat}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-surface-raised"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {updateBadge}
            </div>
          )}
          <h1 className="text-lg font-semibold text-foreground">{i18nService.t('skills')}</h1>
        </div>
        <WindowTitleBar inline />
      </div>

      <div ref={detailContainerRef} className="relative flex-1 overflow-y-auto min-h-0 scrollbar-gutter-stable">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
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
