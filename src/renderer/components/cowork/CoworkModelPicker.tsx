import { ModelSelectorName } from '@shared/components/ai-elements/model-selector';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Bot } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ProviderIcon } from '../../providers/uiRegistry';
import { i18nService } from '../../services/i18n';
import type { Model } from '../../store/slices/modelSlice';
import { PromptSelectorButton } from './PromptSelectorButton';

type CoworkModelPickerProps = {
  models: Model[];
  selectedModel: Model | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (model: Model) => void;
  compact?: boolean;
};

function ModelProviderIcon({ provider }: { provider: string }) {
  return <ProviderIcon id={provider} className="size-4" />;
}

export function CoworkModelPicker({
  models,
  selectedModel,
  open,
  onOpenChange,
  onSelect,
  compact = false,
}: CoworkModelPickerProps) {
  const displayedSelectedModel = models.length > 0 ? selectedModel : null;
  const [searchQuery, setSearchQuery] = useState('');
  const matchingModels = useMemo(() => {
    const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedSearchQuery) return models;

    return models.filter(model =>
      [model.name, model.providerKey, model.provider]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedSearchQuery),
    );
  }, [models, searchQuery]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setSearchQuery('');
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        nativeButton={true}
        render={
          <PromptSelectorButton
            compact={compact}
            label={displayedSelectedModel?.name ?? i18nService.t('selectModel')}
            icon={
              displayedSelectedModel ? (
                <ModelProviderIcon
                  provider={
                    displayedSelectedModel.providerKey ||
                    displayedSelectedModel.provider ||
                    'openai'
                  }
                />
              ) : (
                <Bot className="size-4" />
              )
            }
          />
        }
      />
      <PopoverContent
        className="w-72 rounded-md! border! border-border! bg-surface! p-0 shadow-md ring-0! outline-none!"
        side="bottom"
        align="start"
        sideOffset={4}
      >
        <Command
          shouldFilter={false}
          className="rounded-md! bg-surface! **:data-[slot=input-group]:bg-transparent! **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:text-muted-foreground"
        >
          <CommandInput
            placeholder={i18nService.t('searchModels')}
            className="bg-transparent"
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            {models.length === 0 ? (
              <CommandGroup heading={i18nService.t('availableModels')}>
                <CommandItem disabled value={i18nService.t('modelSelectorNone')}>
                  {i18nService.t('modelSelectorNone')}
                </CommandItem>
              </CommandGroup>
            ) : matchingModels.length === 0 ? (
              <CommandEmpty>{i18nService.t('modelSelectorNoMatches')}</CommandEmpty>
            ) : (
              <CommandGroup heading={i18nService.t('availableModels')}>
                {matchingModels.map(model => (
                  <CommandItem
                    key={model.id}
                    value={model.name}
                    onSelect={() => {
                      onSelect(model);
                      handleOpenChange(false);
                    }}
                  >
                    <ModelProviderIcon provider={model.providerKey || model.provider || 'openai'} />
                    <ModelSelectorName>{model.name}</ModelSelectorName>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
