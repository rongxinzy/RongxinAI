import { Button } from '@shared/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Spinner } from '@shared/components/ui/spinner';
import { SquarePen } from 'lucide-react';
import { useRef } from 'react';

export interface TaskSearchItem {
  id: string;
  title: string;
  context?: string;
  running: boolean;
  current: boolean;
}
interface TaskSearchDialogProps {
  open: boolean;
  query: string;
  items: TaskSearchItem[];
  loading: boolean;
  selectingId: string | null;
  error: string | null;
  isMac: boolean;
  labels: {
    title: string;
    description: string;
    group: string;
    empty: string;
    loading: string;
    quickActions: string;
    newTask: string;
    retry: string;
  };
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRetry?: () => void;
  onNewChat?: () => void;
  newTaskShortcut?: { label: string; matches: (event: KeyboardEvent) => boolean };
}

/** Layout and keyboard affordances only; the controller owns data and navigation. */
export function TaskSearchDialog({
  open,
  query,
  items,
  loading,
  selectingId,
  error,
  isMac,
  labels,
  onQueryChange,
  onClose,
  onSelect,
  onRetry,
  onNewChat,
  newTaskShortcut,
}: TaskSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={inputRef}
        className="theme-task-search-dialog max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-lg"
      >
        <DialogTitle className="sr-only">{labels.title}</DialogTitle>
        <DialogDescription className="sr-only">{labels.description}</DialogDescription>
        <Command
          label={labels.title}
          shouldFilter={false}
          loop
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.repeat || selectingId) return;
            if (onNewChat && newTaskShortcut?.matches(event.nativeEvent)) {
              event.preventDefault();
              event.stopPropagation();
              onNewChat();
              return;
            }
            if (loading) return;
            if (
              (isMac ? event.metaKey : event.ctrlKey) &&
              !event.altKey &&
              !event.shiftKey &&
              /^[1-9]$/.test(event.key)
            ) {
              const item = items[Number(event.key) - 1];
              if (item) {
                event.preventDefault();
                event.stopPropagation();
                onSelect(item.id);
              }
            }
          }}
        >
          <CommandInput
            ref={inputRef}
            variant="palette"
            aria-label={labels.title}
            placeholder={labels.title}
            value={query}
            onValueChange={onQueryChange}
          />
          {error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground"
            >
              <span>{error}</span>
              {onRetry && (
                <Button variant="ghost" size="sm" onClick={onRetry}>
                  {labels.retry}
                </Button>
              )}
            </div>
          )}
          <CommandList className="max-h-[min(24rem,55dvh)]">
            {loading ? (
              <div
                role="status"
                className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
              >
                <Spinner />
                {labels.loading}
              </div>
            ) : (
              <CommandGroup heading={labels.group}>
                {items.length === 0 && (
                  <div role="status" className="px-3 py-6 text-sm text-muted-foreground">
                    {labels.empty}
                  </div>
                )}
                {items.map((item, index) => (
                  <CommandItem
                    key={item.id}
                    variant="palette"
                    value={item.id}
                    disabled={selectingId !== null}
                    onSelect={() => onSelect(item.id)}
                    aria-label={[item.title, item.context].filter(Boolean).join(' ')}
                    aria-keyshortcuts={
                      index < 9 ? `${isMac ? 'Meta' : 'Control'}+${index + 1}` : undefined
                    }
                    aria-current={item.current ? 'page' : undefined}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-4 shrink-0 items-center justify-center"
                    >
                      {(item.running || selectingId === item.id) && (
                        <Spinner className="size-3.5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate group-data-[selected=true]/command-item:font-medium">
                      {item.title}
                    </span>
                    {item.context && (
                      <span className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">
                        {item.context}
                      </span>
                    )}
                    {index < 9 && (
                      <kbd
                        aria-hidden="true"
                        className="shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground"
                      >
                        {isMac ? '⌘' : 'Ctrl+'}
                        {index + 1}
                      </kbd>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          {onNewChat && (
            <CommandGroup heading={labels.quickActions}>
              <CommandItem
                value="action:new-task"
                variant="palette"
                disabled={selectingId !== null}
                onSelect={onNewChat}
              >
                <SquarePen className="size-4 text-muted-foreground" />
                {labels.newTask}
                {newTaskShortcut && (
                  <kbd
                    aria-hidden="true"
                    className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground"
                  >
                    {newTaskShortcut.label}
                  </kbd>
                )}
              </CommandItem>
            </CommandGroup>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}
