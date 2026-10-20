import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import { Activity, AlarmClock, Bot, CodeXml, ListChecks, SquarePen, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { DEFAULT_SHORTCUTS } from '../../config';
import { configService } from '../../services/config';
import { formatShortcutLabel } from '../../services/shortcutLabel';

export const SidebarNavSection = {
  All: 'all',
  Actions: 'actions',
  Destinations: 'destinations',
} as const;
export type SidebarNavSection = (typeof SidebarNavSection)[keyof typeof SidebarNavSection];

const icons = {
  conversation: SquarePen,
  localInference: Bot,
  coding: CodeXml,
  todo: ListChecks,
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
        <span className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
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
  /** Actions sit above search; destinations are the feature rows below it. */
  section?: SidebarNavSection;
  searchRow?: ReactNode;
}

export function SidebarNavigationView({
  isChat,
  workLabel,
  chatLabel,
  onModeChange,
  newConversation,
  entries,
  section = SidebarNavSection.All,
  searchRow,
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
  const shortcutHint = formatShortcutLabel(
    configService.getConfig().shortcuts?.newChat ?? DEFAULT_SHORTCUTS.newChat,
    window.electron?.platform === 'darwin',
  );
  const showActions = section !== SidebarNavSection.Destinations;
  const showDestinations = section !== SidebarNavSection.Actions;
  const handleModeChange = (checked: boolean) => {
    setOptimisticIsChat(checked);
    if (pendingModeChange.current !== null) cancelAnimationFrame(pendingModeChange.current);
    pendingModeChange.current = requestAnimationFrame(() => {
      pendingModeChange.current = null;
      onModeChange(checked);
    });
  };
  if (!showActions && entries.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-4 px-2', showActions ? 'pt-3' : 'pt-4')}>
      {showActions && (
        <>
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
          <div className="flex flex-col gap-0.5">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full justify-start"
              data-testid={newConversation.testId}
              data-active={newConversation.active || undefined}
              aria-current={newConversation.currentPage ? 'page' : undefined}
              onClick={newConversation.onClick}
              onMouseEnter={newConversation.onIntent}
              onFocus={newConversation.onIntent}
            >
              <SquarePen data-icon="inline-start" aria-hidden="true" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-left">{newConversation.label}</span>
              <span className="theme-sidebar-kbd" aria-hidden="true">
                {shortcutHint}
              </span>
            </Button>
            {searchRow}
          </div>
        </>
      )}
      {showDestinations && entries.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {entries.map(entry => (
            <SidebarNavigationItem key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
