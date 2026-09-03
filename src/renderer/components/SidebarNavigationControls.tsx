import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import { useReducedMotion } from 'motion/react';
import { type RefObject, useRef } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../services/i18n';
import { workspaceService } from '../services/workspace';
import type { RootState } from '../store';
import { selectHasActiveActivityRun } from '../store/selectors/activitySelectors';
import { WorkMode } from '../store/workMode/constants';
import type { PrefetchableFeatureView } from './featureViewPrefetch';
import { shouldShowLocalInferenceNavigation } from '../services/managedModelUiPolicy';
import {
  SidebarAnimatedAlarmClockIcon,
  type SidebarAnimatedAlarmClockIconHandle,
} from './icons/SidebarAnimatedAlarmClockIcon';
import {
  SidebarAnimatedActivityIcon,
  type SidebarAnimatedActivityIconHandle,
} from './icons/SidebarAnimatedActivityIcon';
import {
  SidebarAnimatedBotIcon,
  type SidebarAnimatedBotIconHandle,
} from './icons/SidebarAnimatedBotIcon';
import {
  SidebarAnimatedMessageCirclePlusIcon,
  type SidebarAnimatedMessageCirclePlusIconHandle,
} from './icons/SidebarAnimatedMessageCirclePlusIcon';
import {
  SidebarAnimatedUsersIcon,
  type SidebarAnimatedUsersIconHandle,
} from './icons/SidebarAnimatedUsersIcon';
import {
  SidebarAnimatedTerminalIcon,
  type SidebarAnimatedTerminalIconHandle,
} from './icons/SidebarAnimatedTerminalIcon';

export type SidebarActiveView =
  | 'cowork'
  | 'skills'
  | 'scheduledTasks'
  | 'activity'
  | 'mcp'
  | 'localInference'
  | 'expert'
  | 'coding';

interface SidebarNavigationControlsProps {
  activeView: SidebarActiveView;
  onNewChat: () => void;
  onShowExpert: () => void;
  onShowCoding: () => void;
  onShowLocalInference: () => void;
  onShowScheduledTasks: () => void;
  onShowActivity: () => void;
  onWorkModeChange: (checked: boolean) => void;
  workMode: WorkMode;
  managedModelsOnly?: boolean;
  /** Warms the lazily loaded chunk for a view on hover/focus intent. */
  onPrefetchView?: (view: PrefetchableFeatureView) => void;
}

const sidebarViewNavItemClassName =
  'w-full inline-flex items-center justify-start gap-2 rounded-lg border border-transparent bg-transparent px-3 py-1.5 text-left text-sm font-normal text-muted-foreground !transition-colors !duration-200 ease-out hover:border-border hover:!bg-card hover:!text-foreground';
const activeSidebarViewNavItemClassName = cn(
  sidebarViewNavItemClassName,
  'border-border bg-card font-medium text-foreground hover:border-border hover:!bg-card hover:!text-foreground',
);
const sidebarActionNavItemClassName =
  'w-full inline-flex items-center justify-start gap-2 rounded-lg border border-transparent bg-transparent px-3 py-1.5 text-left text-sm font-normal text-muted-foreground !transition-colors !duration-200 ease-out hover:border-border hover:!bg-card hover:!text-foreground';
const activeSidebarActionNavItemClassName = cn(
  sidebarActionNavItemClassName,
  'border-border bg-card font-medium text-foreground hover:border-border hover:!bg-card hover:!text-foreground',
);

export const SidebarNavigationControls = ({
  activeView,
  onNewChat,
  onShowExpert,
  onShowCoding,
  onShowLocalInference,
  onShowScheduledTasks,
  onShowActivity,
  onWorkModeChange,
  workMode,
  managedModelsOnly = false,
  onPrefetchView,
}: SidebarNavigationControlsProps) => {
  const hasActiveActivityRun = useSelector((state: RootState) => selectHasActiveActivityRun(state));
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const scheduledTasksIconRef = useRef<SidebarAnimatedAlarmClockIconHandle>(null);
  const activityIconRef = useRef<SidebarAnimatedActivityIconHandle>(null);
  const newConversationIconRef = useRef<SidebarAnimatedMessageCirclePlusIconHandle>(null);
  const localInferenceIconRef = useRef<SidebarAnimatedBotIconHandle>(null);
  const expertIconRef = useRef<SidebarAnimatedUsersIconHandle>(null);
  const codingIconRef = useRef<SidebarAnimatedTerminalIconHandle>(null);
  const prefersReducedMotion = useReducedMotion();
  const isNewConversationActive =
    activeView === 'cowork' && (workMode !== WorkMode.Chat || activeSkillIds.length === 0);

  const startIconAnimation = (iconRef: RefObject<{ startAnimation: () => void } | null>) => {
    if (!prefersReducedMotion) iconRef.current?.startAnimation();
  };
  const handleNewConversation = () => {
    if (workMode === WorkMode.Work) void workspaceService.clearWorkspaceSelection();
    onNewChat();
  };

  return (
    <div
      className={cn(
        'mt-[5px] flex flex-col gap-0.5 px-3',
        workMode === WorkMode.Chat ? 'pb-0' : 'pb-3',
      )}
    >
      <div
        className="relative h-7 w-full cursor-pointer"
        onClick={() => onWorkModeChange(workMode !== WorkMode.Chat)}
      >
        <Switch
          checked={workMode === WorkMode.Chat}
          onCheckedChange={onWorkModeChange}
          data-mode="work-chat"
        />
        <span
          className={cn(
            'absolute top-1/2 flex items-center gap-1 pointer-events-none transition-opacity duration-200',
            workMode === WorkMode.Work
              ? 'font-semibold text-foreground'
              : 'font-normal text-muted-foreground opacity-50',
          )}
          style={{ left: '25%', transform: 'translate(-50%, -50%)' }}
        >
          <span className="text-sm">{i18nService.t('workMode')}</span>
        </span>
        <span
          className={cn(
            'absolute top-1/2 flex items-center gap-1 pointer-events-none transition-opacity duration-200',
            workMode === WorkMode.Chat
              ? 'font-semibold text-foreground'
              : 'font-normal text-muted-foreground opacity-50',
          )}
          style={{ left: '75%', transform: 'translate(-50%, -50%)' }}
        >
          <span className="text-sm">{i18nService.t('chatMode')}</span>
        </span>
      </div>
      <div className="mt-2!">
        <Button
          type="button"
          variant="ghost"
          onClick={handleNewConversation}
          onMouseEnter={() => startIconAnimation(newConversationIconRef)}
          onMouseLeave={() => newConversationIconRef.current?.stopAnimation()}
          className={
            isNewConversationActive
              ? activeSidebarActionNavItemClassName
              : sidebarActionNavItemClassName
          }
        >
          <SidebarAnimatedMessageCirclePlusIcon ref={newConversationIconRef} />
          {workMode === WorkMode.Chat ? i18nService.t('newChat') : i18nService.t('newTask')}
        </Button>
      </div>
      {shouldShowLocalInferenceNavigation(workMode === WorkMode.Chat, managedModelsOnly) && (
        <Button
          type="button"
          variant="ghost"
          onClick={onShowLocalInference}
          onMouseEnter={() => {
            startIconAnimation(localInferenceIconRef);
            onPrefetchView?.('localInference');
          }}
          onFocus={() => onPrefetchView?.('localInference')}
          onMouseLeave={() => localInferenceIconRef.current?.stopAnimation()}
          className={
            activeView === 'localInference'
              ? activeSidebarViewNavItemClassName
              : sidebarViewNavItemClassName
          }
          aria-current={activeView === 'localInference' ? 'page' : undefined}
        >
          <SidebarAnimatedBotIcon ref={localInferenceIconRef} />
          {i18nService.t('localInferenceTitle')}
        </Button>
      )}
      {workMode !== WorkMode.Chat && (
        <Button
          type="button"
          variant="ghost"
          onClick={onShowCoding}
          onMouseEnter={() => startIconAnimation(codingIconRef)}
          onMouseLeave={() => codingIconRef.current?.stopAnimation()}
          className={
            activeView === 'coding'
              ? activeSidebarViewNavItemClassName
              : sidebarViewNavItemClassName
          }
          aria-current={activeView === 'coding' ? 'page' : undefined}
        >
          <SidebarAnimatedTerminalIcon ref={codingIconRef} />
          {i18nService.t('codingAgent')}
        </Button>
      )}
      {workMode !== WorkMode.Chat && (
        <Button
          type="button"
          variant="ghost"
          onClick={onShowScheduledTasks}
          onMouseEnter={() => {
            startIconAnimation(scheduledTasksIconRef);
            onPrefetchView?.('scheduledTasks');
          }}
          onFocus={() => onPrefetchView?.('scheduledTasks')}
          onMouseLeave={() => scheduledTasksIconRef.current?.stopAnimation()}
          className={
            activeView === 'scheduledTasks'
              ? activeSidebarViewNavItemClassName
              : sidebarViewNavItemClassName
          }
          aria-current={activeView === 'scheduledTasks' ? 'page' : undefined}
        >
          <SidebarAnimatedAlarmClockIcon ref={scheduledTasksIconRef} />
          {i18nService.t('scheduledTasks')}
        </Button>
      )}
      {workMode !== WorkMode.Chat && (
        <Button
          type="button"
          variant="ghost"
          onClick={onShowActivity}
          onMouseEnter={() => {
            startIconAnimation(activityIconRef);
            onPrefetchView?.('activity');
          }}
          onFocus={() => onPrefetchView?.('activity')}
          onMouseLeave={() => activityIconRef.current?.stopAnimation()}
          className={
            activeView === 'activity'
              ? activeSidebarViewNavItemClassName
              : sidebarViewNavItemClassName
          }
          aria-current={activeView === 'activity' ? 'page' : undefined}
        >
          <SidebarAnimatedActivityIcon ref={activityIconRef} />
          {i18nService.t('activityTitle')}
          {hasActiveActivityRun && (
            <span
              className="ml-auto size-1.5 rounded-full bg-primary motion-safe:animate-pulse"
              aria-hidden="true"
            />
          )}
        </Button>
      )}
      {workMode !== WorkMode.Chat && (
        <Button
          type="button"
          variant="ghost"
          onClick={onShowExpert}
          onMouseEnter={() => {
            startIconAnimation(expertIconRef);
            onPrefetchView?.('expert');
          }}
          onFocus={() => onPrefetchView?.('expert')}
          onMouseLeave={() => expertIconRef.current?.stopAnimation()}
          className={
            activeView === 'expert'
              ? activeSidebarViewNavItemClassName
              : sidebarViewNavItemClassName
          }
          aria-current={activeView === 'expert' ? 'page' : undefined}
        >
          <SidebarAnimatedUsersIcon ref={expertIconRef} />
          {i18nService.t('expert')}
        </Button>
      )}
    </div>
  );
};
