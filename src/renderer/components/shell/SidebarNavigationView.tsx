import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import { useReducedMotion } from 'motion/react';
import { useRef } from 'react';

import { SidebarAnimatedActivityIcon } from '../icons/SidebarAnimatedActivityIcon';
import { SidebarAnimatedAlarmClockIcon } from '../icons/SidebarAnimatedAlarmClockIcon';
import { SidebarAnimatedBotIcon } from '../icons/SidebarAnimatedBotIcon';
import { SidebarAnimatedMessageCirclePlusIcon } from '../icons/SidebarAnimatedMessageCirclePlusIcon';
import { SidebarAnimatedTerminalIcon } from '../icons/SidebarAnimatedTerminalIcon';
import { SidebarAnimatedTodoIcon } from '../icons/SidebarAnimatedTodoIcon';
import { SidebarAnimatedUsersIcon } from '../icons/SidebarAnimatedUsersIcon';

const icons = {
  conversation: SidebarAnimatedMessageCirclePlusIcon,
  localInference: SidebarAnimatedBotIcon,
  coding: SidebarAnimatedTerminalIcon,
  todo: SidebarAnimatedTodoIcon,
  scheduledTasks: SidebarAnimatedAlarmClockIcon,
  activity: SidebarAnimatedActivityIcon,
  expert: SidebarAnimatedUsersIcon,
};

export interface SidebarNavigationEntry {
  id: string;
  icon: keyof typeof icons;
  label: string;
  active: boolean;
  currentPage?: boolean;
  running?: boolean;
  testId?: string;
  onClick: () => void;
  onIntent?: () => void;
}

function SidebarNavigationItem({ entry }: { entry: SidebarNavigationEntry }) {
  const iconRef = useRef<{ startAnimation: () => void; stopAnimation: () => void }>(null);
  const reducedMotion = useReducedMotion();
  const Icon = icons[entry.icon];
  return (
    <Button
      type="button"
      variant="navigation"
      size="navigation"
      data-active={entry.active}
      data-testid={entry.testId}
      aria-current={entry.currentPage ? 'page' : undefined}
      onClick={entry.onClick}
      onMouseEnter={() => {
        if (!reducedMotion) iconRef.current?.startAnimation();
        entry.onIntent?.();
      }}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      onFocus={entry.onIntent}
    >
      <div className="flex size-4 shrink-0 items-center justify-center">
        <Icon ref={iconRef} />
      </div>
      <span className="min-w-0 truncate">{entry.label}</span>
      {entry.running && (
        <span
          className="ml-auto size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
          aria-hidden="true"
        />
      )}
    </Button>
  );
}

interface SidebarNavigationViewProps {
  isChat: boolean;
  workLabel: string;
  chatLabel: string;
  onModeChange: (checked: boolean) => void;
  newConversation: SidebarNavigationEntry;
  entries: SidebarNavigationEntry[];
}

export function SidebarNavigationView({
  isChat,
  workLabel,
  chatLabel,
  onModeChange,
  newConversation,
  entries,
}: SidebarNavigationViewProps) {
  return (
    <div className={cn('mt-1 flex flex-col gap-0.5 px-3', isChat ? 'pb-0' : 'pb-3')}>
      <div className="relative h-7 w-full">
        <Switch
          checked={isChat}
          onCheckedChange={onModeChange}
          data-mode="work-chat"
          aria-label={`${workLabel} / ${chatLabel}`}
        />
        {[workLabel, chatLabel].map((label, index) => (
          <span
            key={index}
            data-mode-selected={isChat === (index === 1)}
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 flex w-1/2 items-center justify-center text-sm',
              index === 0 ? 'left-0' : 'left-1/2',
              isChat === (index === 1)
                ? 'font-semibold text-switch-thumb-foreground'
                : 'font-normal text-muted-foreground',
            )}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="mt-2">
        <SidebarNavigationItem entry={newConversation} />
      </div>
      {entries.map(entry => (
        <SidebarNavigationItem key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
