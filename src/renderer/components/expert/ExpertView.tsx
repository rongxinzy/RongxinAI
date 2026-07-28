import { Button } from '@shared/components/ui/button';
import {
  LayeredTabsContent,
  LayeredTabsList,
  LayeredTabsSeparatorEdge,
} from '@shared/components/ui/layered-tabs';
import { Tabs } from '@shared/components/ui/tabs';
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
  onTrySkill?: (skillId: string) => void;
  onUseMcp?: (prompt?: string) => void;
}

const EXPERT_TAB = {
  Experts: 'experts',
  Skills: 'skills',
  Mcp: 'mcp',
} as const;

type ExpertTab = (typeof EXPERT_TAB)[keyof typeof EXPERT_TAB];

const EXPERT_TAB_ORDER: ExpertTab[] = [EXPERT_TAB.Experts, EXPERT_TAB.Skills, EXPERT_TAB.Mcp];

const ExpertView: React.FC<ExpertViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  readOnly,
  onCreateSkillByChat,
  onTrySkill,
  onUseMcp,
}) => {
  const isMac = window.electron.platform === 'darwin';
  const [activeTab, setActiveTab] = useState<ExpertTab>(EXPERT_TAB.Experts);
  const [tabDirection, setTabDirection] = useState(1);
  const expertTabs = [
    { value: EXPERT_TAB.Experts, label: i18nService.t('expert') },
    { value: EXPERT_TAB.Skills, label: i18nService.t('skills') },
    { value: EXPERT_TAB.Mcp, label: i18nService.t('connectors') },
  ] as const;

  const handleTabChange = (value: string) => {
    const nextTab = value as ExpertTab;
    if (nextTab === activeTab) return;
    setTabDirection(
      EXPERT_TAB_ORDER.indexOf(nextTab) >= EXPERT_TAB_ORDER.indexOf(activeTab) ? 1 : -1,
    );
    setActiveTab(nextTab);
  };

  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Header */}
      <div className="draggable flex h-12 shrink-0 items-center justify-between px-4">
        <div className="flex h-8 items-center gap-3">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <Button type="button" variant="ghost" size="icon" onClick={onToggleSidebar}>
                <PanelLeft className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={onNewChat}>
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
        onValueChange={handleTabChange}
        className="min-h-0 flex-1 flex-col gap-0"
      >
        <LayeredTabsList
          value={activeTab}
          items={expertTabs}
          separatorEdge={LayeredTabsSeparatorEdge.Top}
          className="pb-4"
        />

        <LayeredTabsContent
          value={EXPERT_TAB.Experts}
          activeValue={activeTab}
          direction={tabDirection}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
          contentClassName="h-full"
        >
          <PresetExpertList />
        </LayeredTabsContent>

        <LayeredTabsContent
          value={EXPERT_TAB.Skills}
          activeValue={activeTab}
          direction={tabDirection}
          className="min-h-0 flex-1 overflow-hidden px-6 py-4"
          contentClassName="h-full"
        >
          <div className="mx-auto h-full w-full max-w-4xl">
            <SkillsManager
              readOnly={readOnly}
              onCreateByChat={onCreateSkillByChat}
              onTrySkill={onTrySkill}
            />
          </div>
        </LayeredTabsContent>

        <LayeredTabsContent
          value={EXPERT_TAB.Mcp}
          activeValue={activeTab}
          direction={tabDirection}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          contentClassName="h-full"
        >
          <div className="mx-auto h-full w-full max-w-4xl">
            <McpManager onUseMcp={onUseMcp} />
          </div>
        </LayeredTabsContent>
      </Tabs>
    </div>
  );
};

export default ExpertView;
