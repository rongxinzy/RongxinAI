import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from '@shared/components/ai-elements/prompt-input';
import { useEffect, useRef } from 'react';

import { i18nService } from '../../services/i18n';

/** One row of the composer command menu: a command, or a command's choice. */
export interface CodingSlashCommandMenuItem {
  /** Stable key: the command name, or the value inserted after the command. */
  key: string;
  /** Monospace token shown first, e.g. `/mcp`. */
  token: string;
  description?: string;
  hint?: string;
}

interface CodingSlashCommandMenuProps {
  items: CodingSlashCommandMenuItem[];
  selectedKey: string;
  onSelectedKeyChange: (key: string) => void;
  onSelect: (key: string) => void;
}

export const CodingSlashCommandMenu = ({
  items,
  selectedKey,
  onSelectedKeyChange,
  onSelect,
}: CodingSlashCommandMenuProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // cmdk only scrolls the active item when its own store moves the selection.
  // The composer drives the selection through the controlled `value` prop
  // instead, and the re-render that refreshes `aria-selected` lands one commit
  // later, so the highlight is matched by the item's own `data-value` (written
  // when that item commits) rather than by querying the selected attribute.
  useEffect(() => {
    if (!selectedKey) return;
    const candidates = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>('[cmdk-item]') ?? [],
    );
    const active = candidates.find(item => item.getAttribute('data-value') === selectedKey);
    if (!active) return;
    active.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  return (
    <PromptInputCommand
      ref={rootRef}
      id="coding-agent-command-menu"
      shouldFilter={false}
      value={selectedKey}
      onValueChange={onSelectedKeyChange}
      className="absolute inset-x-0 bottom-full mb-2 h-auto! w-full! rounded-xl border border-border bg-popover p-1 shadow-md"
    >
      <PromptInputCommandList className="max-h-72">
        {items.length === 0 ? (
          <PromptInputCommandEmpty>
            {i18nService.t('codingAgentCommandNoMatches')}
          </PromptInputCommandEmpty>
        ) : (
          <PromptInputCommandGroup>
            {items.map(item => (
              <PromptInputCommandItem
                key={item.key}
                value={item.key}
                onSelect={() => onSelect(item.key)}
                className="items-center gap-2 bg-transparent px-3 py-2 transition-colors data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
              >
                <code className="shrink-0 text-sm text-foreground group-data-[selected=true]/command-item:font-semibold">
                  {item.token}
                </code>
                {/* One line per row: the argument hint keeps its own width and
                    the description truncates first, so the row height never
                    changes with the copy length. */}
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  {item.description ? (
                    <span className="min-w-0 truncate text-sm text-muted-foreground group-data-[selected=true]/command-item:text-foreground">
                      {item.description}
                    </span>
                  ) : null}
                  {item.hint ? (
                    <span className="max-w-48 shrink-0 truncate text-xs text-muted-foreground">
                      {item.hint}
                    </span>
                  ) : null}
                </span>
              </PromptInputCommandItem>
            ))}
          </PromptInputCommandGroup>
        )}
      </PromptInputCommandList>
    </PromptInputCommand>
  );
};
