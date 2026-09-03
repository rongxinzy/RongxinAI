import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';

import type { CodingAgentConfigOption } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';

interface CodingComposerConfigControlsProps {
  options: CodingAgentConfigOption[];
  onChange: (optionId: string, value: string | boolean) => void;
  compact?: boolean;
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
  compact = false,
}: CodingComposerConfigControlsProps) => {
  if (compact) {
    if (options.length === 0) return null;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          nativeButton
          render={
            <PromptInputButton aria-label={i18nService.t('settings')}>
              <SlidersHorizontal />
            </PromptInputButton>
          }
        />
        <DropdownMenuContent align="end" side="top" className="min-w-48">
          {options.map(option =>
            option.type === 'select' ? (
              <DropdownMenuSub key={option.id}>
                <DropdownMenuSubTrigger>{option.name}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent side="top" align="end" className="min-w-40">
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
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuCheckboxItem
                key={option.id}
                checked={option.currentValue === true}
                onCheckedChange={checked => onChange(option.id, checked === true)}
              >
                {option.name}
              </DropdownMenuCheckboxItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return options.map(option =>
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
};
