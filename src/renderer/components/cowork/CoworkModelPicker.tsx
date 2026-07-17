import { ModelSelectorLogo, ModelSelectorName } from '@shared/components/ai-elements/model-selector';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';

import { i18nService } from '../../services/i18n';
import type { Model } from '../../store/slices/modelSlice';

type CoworkModelPickerProps = {
  models: Model[];
  selectedModel: Model | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (model: Model) => void;
};

export function CoworkModelPicker({
  models,
  selectedModel,
  open,
  onOpenChange,
  onSelect,
}: CoworkModelPickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <span className="inline-flex max-w-[200px] cursor-pointer items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs hover:bg-black/3 dark:hover:bg-white/4 [&_span]:flex-none">
            {selectedModel ? (
              <>
                <ModelSelectorLogo provider={selectedModel.providerKey || selectedModel.provider || 'openai'} />
                <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
              </>
            ) : (
              <span className="text-muted-foreground">{i18nService.t('selectModel')}</span>
            )}
          </span>
        }
      />
      <PopoverContent
        className="w-72 p-0 bg-background border ring-0 rounded-md!"
        side="top"
        align="start"
        sideOffset={4}
      >
        <Command className="bg-background rounded-md! **:data-[slot=input-group]:bg-transparent **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput placeholder={i18nService.t('searchModels')} />
          <CommandList>
            <CommandGroup heading={i18nService.t('serverModels')}>
              {models.map(model => (
                <CommandItem
                  key={model.id}
                  value={model.name}
                  className="hover:bg-black/3 dark:hover:bg-white/4"
                  onSelect={() => {
                    onSelect(model);
                    onOpenChange(false);
                  }}
                >
                  <ModelSelectorLogo provider={model.providerKey || model.provider || 'openai'} />
                  <ModelSelectorName>{model.name}</ModelSelectorName>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
