import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Bot, Check } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ProviderIcon } from '../../providers/uiRegistry';
import { i18nService } from '../../services/i18n';
import {
  getModelIdentityKey,
  isSameModelIdentity,
  type Model,
} from '../../store/slices/modelSlice';
import { getProviderDisplayName } from '../../config';
import { SelectorOptionContent } from './SelectorOptionContent';
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
        className="theme-model-menu w-72 max-w-[calc(100vw-2rem)]"
        side="bottom"
        align="start"
        sideOffset={4}
      >
        <Command shouldFilter={false} label={i18nService.t('searchModels')}>
          <CommandInput
            placeholder={i18nService.t('searchModels')}
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
                    key={getModelIdentityKey(model)}
                    value={getModelIdentityKey(model)}
                    variant="selector"
                    aria-label={model.name}
                    aria-description={[
                      model.provider || getProviderDisplayName(model.providerKey || 'openai'),
                      displayedSelectedModel && isSameModelIdentity(model, displayedSelectedModel)
                        ? i18nService.t('currentModel')
                        : '',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    onSelect={() => {
                      onSelect(model);
                      handleOpenChange(false);
                    }}
                  >
                    <SelectorOptionContent
                      icon={
                        <ModelProviderIcon
                          provider={model.providerKey || model.provider || 'openai'}
                        />
                      }
                      title={model.name}
                      description={
                        model.provider || getProviderDisplayName(model.providerKey || 'openai')
                      }
                    />
                    <span
                      aria-hidden="true"
                      className="flex size-4 shrink-0 items-center justify-center"
                    >
                      {displayedSelectedModel &&
                        isSameModelIdentity(model, displayedSelectedModel) && (
                          <Check className="size-4" />
                        )}
                    </span>
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
