import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import {
  Activity,
  AlarmClock,
  Bot,
  ListTodo,
  MessageCirclePlus,
  Plus,
  Terminal,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const icons = {
  conversation: MessageCirclePlus,
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
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
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
  // The mode flip re-renders the whole app (sidebar tree + main view) in one
  // blocking commit. Reflect the toggle optimistically in this tiny tree and
  // defer the heavy dispatch one frame, so the thumb's CSS transition starts
  // immediately and keeps running on the compositor during the view swap.
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
  return (
    <div className="flex flex-col gap-4 px-2 py-4">
      <div className="relative h-7 w-full">
        <Switch
          checked={shownIsChat}
          onCheckedChange={handleModeChange}
          data-mode="work-chat"
          aria-label={`${workLabel} / ${chatLabel}`}
        />
        {[workLabel, chatLabel].map((label, index) => (
          <span
            key={index}
            data-mode-selected={shownIsChat === (index === 1)}
            aria-hidden="true"
            className={cn(
              'theme-sidebar-mode-label pointer-events-none absolute inset-y-0 flex w-1/2 items-center justify-center',
              index === 0 ? 'left-0' : 'left-1/2',
            )}
          >
            {label}
          </span>
        ))}
      </div>
      <Button
        type="button"
        variant="default"
        size="lg"
        className="w-full justify-start gap-2"
        data-testid={newConversation.testId}
        data-active={newConversation.active || undefined}
        aria-current={newConversation.currentPage ? 'page' : undefined}
        onClick={newConversation.onClick}
        onMouseEnter={newConversation.onIntent}
        onFocus={newConversation.onIntent}
      >
        <Plus data-icon="inline-start" aria-hidden="true" />
        <span className="min-w-0 truncate">{newConversation.label}</span>
      </Button>
      {entries.length > 0 && (
        <div className="flex flex-col gap-1">
          {entries.map(entry => (
            <SidebarNavigationItem key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
