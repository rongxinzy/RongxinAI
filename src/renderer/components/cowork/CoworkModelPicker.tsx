import { ModelPickerContent } from '@shared/components/model-picker/ModelPicker';
import { CommandGroup, CommandItem } from '@shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Cpu } from 'lucide-react';
import { useMemo, useState } from 'react';
import { i18nService } from '../../services/i18n';
import {
  getModelPickerLabels,
  getRecentModelIds,
  recordRecentModelId,
  toModelPickerItem,
} from '../../services/modelSettings/modelCapabilities';
import type { Model } from '../../store/slices/modelSlice';
import { PromptSelectorButton } from './PromptSelectorButton';
import { SelectorOptionContent } from './SelectorOptionContent';
import { getPreferredReadyLocalModel } from './preferredLocalModel';

type CoworkModelPickerProps = {
  models: Model[];
  selectedModel: Model | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (model: Model) => void;
  compact?: boolean;
  onManageModels?: () => void;
};

export function CoworkModelPicker({
  models,
  selectedModel,
  open,
  onOpenChange,
  onSelect,
  compact = false,
  onManageModels,
}: CoworkModelPickerProps) {
  const displayedSelectedModel = models.find(model => model.id === selectedModel?.id) ?? null;
  const readyLocalModel = getPreferredReadyLocalModel(models, selectedModel);
  const [searchQuery, setSearchQuery] = useState('');

  const items = useMemo(() => models.map(toModelPickerItem), [models]);
  const recentIds = useMemo(() => (open ? getRecentModelIds() : []), [open]);
  const labels = useMemo(() => getModelPickerLabels(), []);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setSearchQuery('');
    }
  };

  const handlePickModel = (model: Model) => {
    recordRecentModelId(model.id);
    onSelect(model);
    handleOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        nativeButton={true}
        render={
          <PromptSelectorButton
            compact={compact}
            label={displayedSelectedModel?.name ?? i18nService.t('selectModel')}
          />
        }
      />
      <PopoverContent
        className="theme-model-menu w-80 max-w-[calc(100vw-2rem)]"
        side="bottom"
        align="start"
        sideOffset={4}
      >
        <ModelPickerContent
          items={items}
          selectedId={displayedSelectedModel?.id ?? null}
          recentIds={recentIds}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          labels={labels}
          onSelect={item => {
            const matched = models.find(model => model.id === item.id);
            if (matched) handlePickModel(matched);
          }}
          onManageModels={
            onManageModels
              ? () => {
                  handleOpenChange(false);
                  onManageModels();
                }
              : undefined
          }
          topSlot={
            !searchQuery.trim() ? (
              <CommandGroup heading={i18nService.t('coworkLocalModelsHeading')}>
                <CommandItem
                  value="use-ready-local-model"
                  variant="selector"
                  disabled={!readyLocalModel}
                  onSelect={() => {
                    if (!readyLocalModel) return;
                    handlePickModel(readyLocalModel);
                  }}
                >
                  <SelectorOptionContent
                    icon={<Cpu className="size-4" />}
                    title={i18nService.t('coworkUseLocalModel')}
                    description={readyLocalModel?.name ?? i18nService.t('coworkLocalModelNotReady')}
                  />
                </CommandItem>
              </CommandGroup>
            ) : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}
