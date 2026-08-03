import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import { useReducedMotion } from 'motion/react';
import { type RefObject, useRef } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../services/i18n';
import type { RootState } from '../store';
import { selectHasActiveChannelRun } from '../store/selectors/activitySelectors';
import { WorkMode } from '../store/workMode/constants';
import type { PrefetchableFeatureView } from './featureViewPrefetch';
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

export type SidebarActiveView =
  | 'cowork'
  | 'skills'
  | 'scheduledTasks'
  | 'activity'
  | 'mcp'
  | 'localInference'
  | 'expert';

interface SidebarNavigationControlsProps {
  activeView: SidebarActiveView;
  onNewChat: () => void;
  onShowExpert: () => void;
  onShowLocalInference: () => void;
  onShowScheduledTasks: () => void;
  onShowActivity: () => void;
  onWorkModeChange: (checked: boolean) => void;
  workMode: WorkMode;
  /** Warms the lazily loaded chunk for a view on hover/focus intent. */
  onPrefetchView?: (view: PrefetchableFeatureView) => void;
}

const sidebarNavItemClassName =
  'w-full inline-flex items-center justify-start gap-2 rounded-lg px-3 py-1.5 text-left text-sm font-normal text-muted-foreground transition-[background-color,color,box-shadow] duration-150 hover:bg-card hover:text-foreground';
const activeSidebarNavItemClassName = cn(
  sidebarNavItemClassName,
  'bg-card font-medium text-foreground shadow-sm ring-1 ring-inset ring-border hover:bg-card',
);

export const SidebarNavigationControls = ({
  activeView,
  onNewChat,
  onShowExpert,
  onShowLocalInference,
  onShowScheduledTasks,
  onShowActivity,
  onWorkModeChange,
  workMode,
  onPrefetchView,
}: SidebarNavigationControlsProps) => {
  const hasActiveChannelRun = useSelector((state: RootState) => selectHasActiveChannelRun(state));
  const scheduledTasksIconRef = useRef<SidebarAnimatedAlarmClockIconHandle>(null);
  const activityIconRef = useRef<SidebarAnimatedActivityIconHandle>(null);
  const newConversationIconRef = useRef<SidebarAnimatedMessageCirclePlusIconHandle>(null);
  const localInferenceIconRef = useRef<SidebarAnimatedBotIconHandle>(null);
  const expertIconRef = useRef<SidebarAnimatedUsersIconHandle>(null);
  const prefersReducedMotion = useReducedMotion();

  const startIconAnimation = (iconRef: RefObject<{ startAnimation: () => void } | null>) => {
    if (!prefersReducedMotion) iconRef.current?.startAnimation();
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
            'absolute top-1/2 flex items-center gap-1 pointer-events-none transition-all duration-200',
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
            'absolute top-1/2 flex items-center gap-1 pointer-events-none transition-all duration-200',
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
          onClick={onNewChat}
          onMouseEnter={() => startIconAnimation(newConversationIconRef)}
          onMouseLeave={() => newConversationIconRef.current?.stopAnimation()}
          className={sidebarNavItemClassName}
        >
          <SidebarAnimatedMessageCirclePlusIcon ref={newConversationIconRef} />
          {workMode === WorkMode.Chat ? i18nService.t('newChat') : i18nService.t('newTask')}
        </Button>
      </div>
      {workMode !== WorkMode.Chat && (
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
              ? activeSidebarNavItemClassName
              : sidebarNavItemClassName
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
          onClick={onShowScheduledTasks}
          onMouseEnter={() => {
            startIconAnimation(scheduledTasksIconRef);
            onPrefetchView?.('scheduledTasks');
          }}
          onFocus={() => onPrefetchView?.('scheduledTasks')}
          onMouseLeave={() => scheduledTasksIconRef.current?.stopAnimation()}
          className={
            activeView === 'scheduledTasks'
              ? activeSidebarNavItemClassName
              : sidebarNavItemClassName
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
            activeView === 'activity' ? activeSidebarNavItemClassName : sidebarNavItemClassName
          }
          aria-current={activeView === 'activity' ? 'page' : undefined}
        >
          <SidebarAnimatedActivityIcon ref={activityIconRef} />
          {i18nService.t('activityTitle')}
          {hasActiveChannelRun && (
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
            activeView === 'expert' ? activeSidebarNavItemClassName : sidebarNavItemClassName
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
