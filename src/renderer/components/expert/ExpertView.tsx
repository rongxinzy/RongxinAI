import { Button } from '@shared/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { PanelLeft, Pencil } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import McpManager from '../mcp/McpManager';
import SkillsManager from '../skills/SkillsManager';
import WindowTitleBar from '../window/WindowTitleBar';
import PresetExpertList from './PresetExpertList';

interface ExpertViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  readOnly?: boolean;
  onCreateSkillByChat?: () => void;
}

type ExpertTab = 'experts' | 'skills' | 'mcp';

const ExpertView: React.FC<ExpertViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  readOnly,
  onCreateSkillByChat,
}) => {
  const isMac = window.electron.platform === 'darwin';
  const [activeTab, setActiveTab] = useState<ExpertTab>('experts');

  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Header */}
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
          <h1 className="text-lg font-semibold text-foreground">{i18nService.t('expert')}</h1>
        </div>
        <WindowTitleBar inline />
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={value => setActiveTab(value as ExpertTab)}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="flex items-center justify-between px-4 pt-3 shrink-0">
          <TabsList variant="default">
            <TabsTrigger value="experts">{i18nService.t('expert')}</TabsTrigger>
            <TabsTrigger value="skills">{i18nService.t('skills')}</TabsTrigger>
            <TabsTrigger value="mcp">{i18nService.t('mcpServers')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="experts" className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <PresetExpertList />
        </TabsContent>

        <TabsContent value="skills" className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <SkillsManager readOnly={readOnly} onCreateByChat={onCreateSkillByChat} />
        </TabsContent>

        <TabsContent value="mcp" className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <McpManager />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExpertView;
