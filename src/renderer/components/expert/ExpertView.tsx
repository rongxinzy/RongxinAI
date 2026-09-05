import { LayeredTabsContent } from '@shared/components/ui/layered-tabs';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { Tabs } from '@shared/components/ui/tabs';
import { Users } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import McpManager from '../mcp/McpManager';
import PageHeader from '../PageHeader';
import SkillsManager from '../skills/SkillsManager';
import PresetExpertList from './PresetExpertList';

interface ExpertViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  readOnly?: boolean;
  onCreateSkillByChat?: () => void;
  onTrySkill?: (skillId: string) => void;
  onChatWithExpert?: (agentId: string) => void;
  onUseMcp?: (prompt?: string) => void;
  /** Tab to open on mount (view remounts on every navigation, so this takes effect each time) */
  initialTab?: ExpertTab;
}

export const EXPERT_TAB = {
  Experts: 'experts',
  Skills: 'skills',
  Mcp: 'mcp',
} as const;

export type ExpertTab = (typeof EXPERT_TAB)[keyof typeof EXPERT_TAB];

const EXPERT_TAB_ORDER: ExpertTab[] = [EXPERT_TAB.Experts, EXPERT_TAB.Skills, EXPERT_TAB.Mcp];

const ExpertView: React.FC<ExpertViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  readOnly,
  onCreateSkillByChat,
  onTrySkill,
  onChatWithExpert,
  onUseMcp,
  initialTab,
}) => {
  const [activeTab, setActiveTab] = useState<ExpertTab>(initialTab ?? EXPERT_TAB.Experts);
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
    <div data-page-canvas className="flex-1 flex flex-col bg-background h-full">
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="min-h-0 flex-1 flex-col gap-0"
      >
        <PageHeader
          title={i18nService.t('expert')}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onNewChat={onNewChat}
          updateBadge={updateBadge}
          tabs={<PageTabs bare value={activeTab} items={expertTabs} />}
        />

        <LayeredTabsContent
          value={EXPERT_TAB.Experts}
          activeValue={activeTab}
          direction={tabDirection}
          className="min-h-0 flex-1 overflow-y-auto"
          contentClassName="h-full"
        >
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 sm:px-6">
            <header className="flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-muted">
                <Users className="size-6 text-primary" aria-hidden="true" />
              </div>
              <p className="min-w-0 text-sm text-muted-foreground">
                {i18nService.t('expertsDescription')}
              </p>
            </header>
            <PresetExpertList onChatWithExpert={onChatWithExpert} />
          </div>
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
