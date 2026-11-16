import { Button } from '@shared/components/ui/button';
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
      className="theme-conversation-mention-list z-50 max-h-60 max-w-[calc(100vw-16px)] overflow-y-auto"
    >
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        return (
          <Button
            variant="navigation"
            size="navigation"
            key={`${item.kind}:${item.id}`}
            type="button"
            role="option"
            aria-selected={isSelected}
            onMouseDown={event => {
              event.preventDefault();
              selectItem(index);
            }}
            onMouseEnter={() => setSelectedIndex(index)}
            className="w-full justify-start gap-2"
          >
            {item.kind === 'skill' ? (
              <Sparkles className="theme-conversation-icon shrink-0" />
            ) : (
              <FileText className="theme-conversation-icon shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.description ? (
              <span className="theme-conversation-meta max-w-28 shrink-0 truncate">
                {item.description}
              </span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
});

MentionSuggestionList.displayName = 'MentionSuggestionList';
