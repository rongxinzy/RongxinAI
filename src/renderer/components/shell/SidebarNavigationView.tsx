import { Button } from '@shared/components/ui/button';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Activity, AlarmClock, Bot, ListTodo, SquarePen, Terminal, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { SidebarModeTab } from './sidebarModeTabsConstants';

const icons = {
  conversation: SquarePen,
  localInference: Bot,
  coding: Terminal,
  todo: ListTodo,
  scheduledTasks: AlarmClock,
  activity: Activity,
  expert: Users,
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
  const Icon = icons[entry.icon];
  return (
    <Button
      type="button"
      variant="navigation"
      size="navigation"
      data-active={entry.active || undefined}
      data-testid={entry.testId}
      aria-current={entry.currentPage ? 'page' : undefined}
      onClick={entry.onClick}
      onMouseEnter={entry.onIntent}
      onFocus={entry.onIntent}
    >
      <div className="flex size-4 shrink-0 items-center justify-center">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" strokeWidth={1.75} />
      </div>
      <span className="min-w-0 truncate">{entry.label}</span>
      {entry.running && (
        <span
          className="ml-auto size-1.5 shrink-0 rounded-full bg-primary"
          role="img"
          aria-label="running"
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
  const [optimisticIsChat, setOptimisticIsChat] = useState<boolean | null>(null);
  const pendingModeChange = useRef<number | null>(null);
  useEffect(() => {
    setOptimisticIsChat(null);
  }, [isChat]);
  useEffect(
    () => () => {
      if (pendingModeChange.current !== null) cancelAnimationFrame(pendingModeChange.current);
    },
    [],
  );
  const shownIsChat = optimisticIsChat ?? isChat;
  const handleModeChange = (checked: boolean) => {
    setOptimisticIsChat(checked);
    if (pendingModeChange.current !== null) cancelAnimationFrame(pendingModeChange.current);
    pendingModeChange.current = requestAnimationFrame(() => {
      pendingModeChange.current = null;
      onModeChange(checked);
    });
  };

  const modeTabValue = shownIsChat ? SidebarModeTab.Chat : SidebarModeTab.Work;

  return (
    <div className="flex flex-col gap-4 px-2 py-3">
      <FluidTabs
        aria-label={`${workLabel} / ${chatLabel}`}
        className="w-full"
        value={modeTabValue}
        items={[
          { label: workLabel, value: SidebarModeTab.Work },
          { label: chatLabel, value: SidebarModeTab.Chat },
        ]}
        onValueChange={value => handleModeChange(value === SidebarModeTab.Chat)}
      />
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full justify-start gap-2.5"
        data-testid={newConversation.testId}
        data-active={newConversation.active || undefined}
        aria-current={newConversation.currentPage ? 'page' : undefined}
        onClick={newConversation.onClick}
        onMouseEnter={newConversation.onIntent}
        onFocus={newConversation.onIntent}
      >
        <SquarePen
          data-icon="inline-start"
          aria-hidden="true"
          className="size-4"
          strokeWidth={1.75}
        />
        <span className="min-w-0 truncate">{newConversation.label}</span>
      </Button>
      {entries.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {entries.map(entry => (
            <SidebarNavigationItem key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
