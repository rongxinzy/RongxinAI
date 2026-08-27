import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';

import type { CodingAgentConfigOption } from '../../../shared/codingAgent';

interface CodingComposerConfigControlsProps {
  options: CodingAgentConfigOption[];
  onChange: (optionId: string, value: string | boolean) => void;
}

const selectedOptionLabel = (option: CodingAgentConfigOption): string => {
  if (typeof option.currentValue !== 'string') return option.name;
  return (
    option.options?.find(value => value.value === option.currentValue)?.name ?? option.currentValue
  );
};

export const CodingComposerConfigControls = ({
  options,
  onChange,
}: CodingComposerConfigControlsProps) =>
  options.map(option =>
    option.type === 'select' ? (
      <DropdownMenu key={option.id}>
        <DropdownMenuTrigger
          nativeButton
          render={
            <PromptInputButton
              className="max-w-48 gap-1 px-2 text-sm hover:bg-surface-raised"
              aria-label={option.name}
            >
              <span className="truncate">{selectedOptionLabel(option)}</span>
              <ChevronDown className="shrink-0 text-muted-foreground" />
            </PromptInputButton>
          }
        />
        <DropdownMenuContent align="start" side="top" className="min-w-40">
          <DropdownMenuRadioGroup
            value={typeof option.currentValue === 'string' ? option.currentValue : ''}
            onValueChange={value => onChange(option.id, value)}
          >
            {option.options?.map(value => (
              <DropdownMenuRadioItem key={value.value} value={value.value}>
                {value.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <PromptInputButton
        key={option.id}
        className="max-w-48 gap-1 px-2 text-sm hover:bg-surface-raised"
        aria-label={option.name}
        aria-pressed={option.currentValue === true}
        tooltip={option.description ?? option.name}
        onClick={() => onChange(option.id, option.currentValue !== true)}
      >
        {option.currentValue === true ? <Check /> : null}
        <span className="truncate">{option.name}</span>
      </PromptInputButton>
    ),
  );
