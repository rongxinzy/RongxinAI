import { cn } from '@shared/lib/utils';
import { Sparkles, FileText } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

export interface MentionCandidate {
  id: string;
  label: string;
  description?: string;
  kind: 'skill' | 'file';
  iconUrl?: string;
}

export interface MentionSuggestionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MentionSuggestionListProps {
  items: MentionCandidate[];
  command: (item: MentionCandidate) => void;
}

/**
 * Floating mention popup rendered via Tiptap ReactRenderer for `@` skill/file mentions.
 */
export const MentionSuggestionList = forwardRef<
  MentionSuggestionListHandle,
  MentionSuggestionListProps
>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const selectItem = (index: number): void => {
    const item = items[index];
    if (item) {
      command(item);
    }
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex(prev => (prev + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex(prev => (prev + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;

  return (
    <div
      role="listbox"
      className="z-50 max-h-60 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        return (
          <button
            key={`${item.kind}:${item.id}`}
            type="button"
            role="option"
            aria-selected={isSelected}
            onMouseDown={event => {
              event.preventDefault();
              selectItem(index);
            }}
            onMouseEnter={() => setSelectedIndex(index)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-100',
              isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
            )}
          >
            {item.kind === 'skill' ? (
              <Sparkles className="size-3.5 shrink-0 text-primary" />
            ) : (
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {item.label}
            </span>
            {item.description ? (
              <span className="max-w-28 shrink-0 truncate text-muted-foreground">
                {item.description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
});

MentionSuggestionList.displayName = 'MentionSuggestionList';
