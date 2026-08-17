import { Button } from '@shared/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { cn } from '@shared/lib/utils';
import { PanelLeft } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import { ArtifactPanelAnimatedToggleIcon } from '../icons/ArtifactPanelAnimatedToggleIcon';
import { SidebarAnimatedMessageCirclePlusIcon } from '../icons/SidebarAnimatedMessageCirclePlusIcon';
import WindowTitleBar from '../window/WindowTitleBar';
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
  isMac: boolean;
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
  isMac,
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
      <header className="shrink-0 bg-background">
        <div className="draggable flex h-10 items-center justify-between px-4">
          <div className="flex h-full min-w-0 items-center gap-2">
            {isSidebarCollapsed && (
              <div className={cn('non-draggable flex items-center gap-2', isMac && 'pl-[68px]')}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleSidebar}
                  aria-label={i18nService.t('coworkShowSidebar')}
                >
                  <PanelLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onNewChat}
                  aria-label={i18nService.t('newChat')}
                >
                  <SidebarAnimatedMessageCirclePlusIcon />
                </Button>
                {updateBadge}
              </div>
            )}
            {isSessionSwitching ? (
              <CoworkSessionTitleLoadingSkeleton />
            ) : (
              <h1 className="max-w-md truncate text-sm font-medium leading-none text-foreground">
                {title}
              </h1>
            )}
          </div>

          <div className="non-draggable flex items-center gap-1">
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
            <WindowTitleBar inline className="ml-1" />
          </div>
        </div>

        <div className="non-draggable border-b border-border px-4">
          <TabsList variant="line" className="h-8">
            <TabsTrigger
              value={CoworkSessionView.Conversation}
              disabled={isSessionSwitching}
              className="after:bottom-[-1px]"
            >
              {i18nService.t('coworkConversationTab')}
            </TabsTrigger>
            <TabsTrigger
              value={CoworkSessionView.Trace}
              disabled={isSessionSwitching}
              className="after:bottom-[-1px]"
            >
              {i18nService.t('coworkTraceTab')}
            </TabsTrigger>
          </TabsList>
        </div>
      </header>

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
