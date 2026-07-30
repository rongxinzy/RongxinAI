import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import { useReducedMotion } from 'motion/react';
import { type RefObject, useRef } from 'react';

import { i18nService } from '../services/i18n';
import { WorkMode } from '../store/workMode/constants';
import {
  SidebarAnimatedAlarmClockIcon,
  type SidebarAnimatedAlarmClockIconHandle,
} from './icons/SidebarAnimatedAlarmClockIcon';
import {
  SidebarAnimatedCpuIcon,
  type SidebarAnimatedCpuIconHandle,
} from './icons/SidebarAnimatedCpuIcon';
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
  | 'mcp'
  | 'localInference'
  | 'expert';

interface SidebarNavigationControlsProps {
  activeView: SidebarActiveView;
  onNewChat: () => void;
  onShowExpert: () => void;
  onShowLocalInference: () => void;
  onShowScheduledTasks: () => void;
  onWorkModeChange: (checked: boolean) => void;
  workMode: WorkMode;
}

const sidebarNavItemClassName =
  'w-full inline-flex items-center justify-start gap-2 rounded-lg px-3 py-1.5 text-left text-sm font-normal text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground';
const activeSidebarNavItemClassName = `${sidebarNavItemClassName} bg-surface-raised text-foreground`;

export const SidebarNavigationControls = ({
  activeView,
  onNewChat,
  onShowExpert,
  onShowLocalInference,
  onShowScheduledTasks,
  onWorkModeChange,
  workMode,
}: SidebarNavigationControlsProps) => {
  const scheduledTasksIconRef = useRef<SidebarAnimatedAlarmClockIconHandle>(null);
  const newConversationIconRef = useRef<SidebarAnimatedMessageCirclePlusIconHandle>(null);
  const localInferenceIconRef = useRef<SidebarAnimatedCpuIconHandle>(null);
  const expertIconRef = useRef<SidebarAnimatedUsersIconHandle>(null);
  const prefersReducedMotion = useReducedMotion();

  const startIconAnimation = (iconRef: RefObject<{ startAnimation: () => void } | null>) => {
    if (!prefersReducedMotion) iconRef.current?.startAnimation();
  };

  return (
    <div className={cn('mt-[5px] space-y-0.5 px-3', workMode === WorkMode.Chat ? 'pb-0' : 'pb-3')}>
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
          onMouseEnter={() => startIconAnimation(localInferenceIconRef)}
          onMouseLeave={() => localInferenceIconRef.current?.stopAnimation()}
          className={
            activeView === 'localInference'
              ? activeSidebarNavItemClassName
              : sidebarNavItemClassName
          }
          aria-current={activeView === 'localInference' ? 'page' : undefined}
        >
          <SidebarAnimatedCpuIcon ref={localInferenceIconRef} />
          {i18nService.t('localInferenceTitle')}
        </Button>
      )}
      {workMode !== WorkMode.Chat && (
        <Button
          type="button"
          variant="ghost"
          onClick={onShowScheduledTasks}
          onMouseEnter={() => startIconAnimation(scheduledTasksIconRef)}
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
          onClick={onShowExpert}
          onMouseEnter={() => startIconAnimation(expertIconRef)}
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
