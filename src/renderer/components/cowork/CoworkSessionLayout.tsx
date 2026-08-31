import { Button } from '@shared/components/ui/button';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { Tabs, TabsContent } from '@shared/components/ui/tabs';
import { cn } from '@shared/lib/utils';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import { ArtifactPanelAnimatedToggleIcon } from '../icons/ArtifactPanelAnimatedToggleIcon';
import PageHeader from '../PageHeader';
import {
  CoworkSessionView,
  isCoworkSessionView,
  type CoworkSessionView as CoworkSessionViewType,
} from './constants';
import { CoworkSessionTitleLoadingSkeleton } from './CoworkSessionLoadingState';
import { WorkbenchTaskTrajectory } from './WorkbenchTaskTrajectory';

interface CoworkSessionLayoutProps {
  title: string;
  sessionId?: string;
  isSessionSwitching: boolean;
  isSidebarCollapsed?: boolean;
  isArtifactPanelOpen: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  onToggleArtifactPanel: () => void;
  updateBadge?: React.ReactNode;
  children: React.ReactNode;
}

const panelTransitionClassName = cn(
  'absolute inset-0 flex min-h-0 flex-col overflow-hidden transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
  'data-starting-style:opacity-0 data-ending-style:opacity-0',
  'data-[activation-direction=right]:data-starting-style:translate-x-7',
  'data-[activation-direction=right]:data-ending-style:-translate-x-7',
  'data-[activation-direction=left]:data-starting-style:-translate-x-7',
  'data-[activation-direction=left]:data-ending-style:translate-x-7',
);

export function CoworkSessionLayout({
  title,
  sessionId,
  isSessionSwitching,
  isSidebarCollapsed,
  isArtifactPanelOpen,
  onToggleSidebar,
  onNewChat,
  onToggleArtifactPanel,
  updateBadge,
  children,
}: CoworkSessionLayoutProps) {
  const [activeView, setActiveView] = useState<CoworkSessionViewType>(
    CoworkSessionView.Conversation,
  );
  const isConversationView = activeView === CoworkSessionView.Conversation;

  return (
    <Tabs
      value={activeView}
      onValueChange={value => {
        if (isCoworkSessionView(value)) setActiveView(value);
      }}
      className="h-full min-h-0 flex-1 gap-0 overflow-hidden bg-background"
    >
      <PageHeader
        title={isSessionSwitching ? undefined : title}
        leftContent={isSessionSwitching ? <CoworkSessionTitleLoadingSkeleton /> : undefined}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleArtifactPanel}
            aria-label={i18nService.t('artifactPanelToggle')}
            aria-hidden={!isConversationView}
            tabIndex={isConversationView ? 0 : -1}
            disabled={isSessionSwitching || !isConversationView}
            className={cn(!isConversationView && 'invisible')}
          >
            <ArtifactPanelAnimatedToggleIcon open={!isSessionSwitching && isArtifactPanelOpen} />
          </Button>
        }
        tabs={
          <PageTabs
            bare
            value={activeView}
            items={[
              {
                value: CoworkSessionView.Conversation,
                label: i18nService.t('coworkConversationTab'),
                disabled: isSessionSwitching,
              },
              {
                value: CoworkSessionView.Trace,
                label: i18nService.t('coworkTraceTab'),
                disabled: isSessionSwitching,
              },
            ]}
          />
        }
      />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <TabsContent
          value={CoworkSessionView.Conversation}
          keepMounted
          className={panelTransitionClassName}
        >
          {children}
        </TabsContent>
        <TabsContent
          value={CoworkSessionView.Trace}
          keepMounted
          className={panelTransitionClassName}
        >
          <WorkbenchTaskTrajectory
            sessionId={sessionId}
            active={activeView === CoworkSessionView.Trace}
            loadingOverride={isSessionSwitching}
            onBackToConversation={() => setActiveView(CoworkSessionView.Conversation)}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}
