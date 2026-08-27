import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from '@shared/components/ai-elements/prompt-input';

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
}: CodingSlashCommandMenuProps) => (
  <PromptInputCommand
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
