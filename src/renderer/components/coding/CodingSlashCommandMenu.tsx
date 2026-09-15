import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from '@shared/components/ai-elements/prompt-input';
import { useEffect, useRef } from 'react';

import type { CodingAgentAvailableCommand } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';

interface CodingSlashCommandMenuProps {
  commands: CodingAgentAvailableCommand[];
  selectedName: string;
  onSelectedNameChange: (name: string) => void;
  onSelect: (command: CodingAgentAvailableCommand) => void;
}

export const CodingSlashCommandMenu = ({
  commands,
  selectedName,
  onSelectedNameChange,
  onSelect,
}: CodingSlashCommandMenuProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // cmdk only scrolls the active item when its own store moves the selection.
  // The composer drives the selection through the controlled `value` prop
  // instead, and the re-render that refreshes `aria-selected` lands one commit
  // later, so the highlight is matched by the item's own `data-value` (written
  // when that item commits) rather than by querying the selected attribute.
  useEffect(() => {
    if (!selectedName) return;
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>('[cmdk-item]') ?? [],
    );
    const active = items.find(item => item.getAttribute('data-value') === selectedName);
    if (!active) return;
    if (active.parentElement?.firstElementChild === active) {
      active
        .closest('[cmdk-group=""]')
        ?.querySelector('[cmdk-group-heading=""]')
        ?.scrollIntoView({ block: 'nearest' });
    }
    active.scrollIntoView({ block: 'nearest' });
  }, [selectedName]);

  return (
    <PromptInputCommand
      ref={rootRef}
      id="coding-agent-command-menu"
      shouldFilter={false}
      value={selectedName}
      onValueChange={onSelectedNameChange}
      className="absolute inset-x-0 bottom-full mb-2 h-auto! w-full! rounded-xl border border-border bg-popover p-1 shadow-md"
    >
      <PromptInputCommandList className="max-h-72">
        {commands.length === 0 ? (
          <PromptInputCommandEmpty>
            {i18nService.t('codingAgentCommandNoMatches')}
          </PromptInputCommandEmpty>
        ) : (
          <PromptInputCommandGroup heading={i18nService.t('codingAgentCommands')}>
            {commands.map(command => (
              <PromptInputCommandItem
                key={command.name}
                value={command.name}
                onSelect={() => onSelect(command)}
                className="items-start gap-2 bg-transparent px-3 py-2 transition-colors data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
              >
                <code className="shrink-0 text-sm text-foreground group-data-[selected=true]/command-item:font-semibold">
                  /{command.name}
                </code>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-muted-foreground group-data-[selected=true]/command-item:text-foreground">
                    {command.description}
                  </span>
                  {command.input?.hint ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {command.input.hint}
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
