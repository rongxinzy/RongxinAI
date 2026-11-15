import {
  ModelPicker,
  type ModelPickerItem,
  type ModelPickerLabels,
} from '@shared/components/model-picker/ModelPicker';
import { FluidTabs, FluidTabsSize } from '@shared/components/ui/fluid-tabs';
import type {
  MagpieModelRef,
  MagpiePreferences,
  MagpiePreferencesPatch,
} from '../../../../shared/magpie/preferences';
import { i18nService } from '../../../services/i18n';

function mapRefsToPickerItems(refs: MagpieModelRef[]): ModelPickerItem[] {
  return refs.map(ref => ({
    id: ref.id,
    name: ref.name || ref.id,
    providerLabel: ref.providerName || '',
    providerKey: ref.providerName || 'custom',
  }));
}

export interface ScenarioModelsSectionProps {
  preferences: MagpiePreferences;
  pickerLabels: ModelPickerLabels;
  disabled?: boolean;
  onUpdate: (patch: MagpiePreferencesPatch) => Promise<boolean>;
}

export function ScenarioModelsSection({
  preferences,
  pickerLabels,
  disabled = false,
  onUpdate,
}: ScenarioModelsSectionProps) {
  const visionItems = mapRefsToPickerItems(preferences.visionModels ?? []);
  const searchRefs = (preferences.searchChoices ?? []).flatMap(choice => choice.models ?? []);
  const searchItems = mapRefsToPickerItems(searchRefs);
  const imageGenItems = mapRefsToPickerItems(preferences.imageGenModels ?? []);

  const effortItems = (preferences.visionEfforts || []).map(effort => ({
    value: effort,
    label: i18nService.t(`magpieEffort_${effort}`) || effort,
  }));

  const currentVision =
    preferences.vision && preferences.vision !== 'off' ? preferences.vision : null;
  const currentSearcher =
    preferences.searcher && preferences.searcher !== 'off' ? preferences.searcher : null;
  const currentImageGen =
    preferences.imageGen && preferences.imageGen !== 'off' ? preferences.imageGen : null;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-medium text-foreground">
          {i18nService.t('modelsScenarioSectionTitle')}
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {i18nService.t('modelsScenarioSectionDesc')}
        </p>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {effortItems.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {i18nService.t('modelsScenarioReasoningLabel')}
              </div>
              <div className="text-xs text-muted-foreground">
                {i18nService.t('modelsScenarioReasoningDesc')}
              </div>
            </div>
            <FluidTabs
              aria-label={i18nService.t('modelsScenarioReasoningLabel')}
              size={FluidTabsSize.Small}
              items={effortItems}
              value={preferences.visionEffort || effortItems[0].value}
              disabled={disabled}
              onValueChange={visionEffort => void onUpdate({ visionEffort })}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">
              {i18nService.t('modelsScenarioVisionLabel')}
            </div>
            <div className="text-xs text-muted-foreground">
              {i18nService.t('modelsScenarioVisionDesc')}
            </div>
          </div>
          <ModelPicker
            items={visionItems}
            selectedId={currentVision}
            allowFollowDefault
            disabled={disabled}
            align="end"
            triggerClassName="w-60"
            labels={pickerLabels}
            onSelect={item => void onUpdate({ vision: item.id })}
            onSelectFollowDefault={() => void onUpdate({ vision: '' })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">
              {i18nService.t('modelsScenarioWebSearchLabel')}
            </div>
            <div className="text-xs text-muted-foreground">
              {i18nService.t('modelsScenarioWebSearchDesc')}
            </div>
          </div>
          <ModelPicker
            items={searchItems}
            selectedId={currentSearcher}
            allowFollowDefault
            disabled={disabled}
            align="end"
            triggerClassName="w-60"
            labels={pickerLabels}
            onSelect={item => void onUpdate({ searcher: item.id })}
            onSelectFollowDefault={() => void onUpdate({ searcher: '' })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">
              {i18nService.t('modelsScenarioImageGenLabel')}
            </div>
            <div className="text-xs text-muted-foreground">
              {i18nService.t('modelsScenarioImageGenDesc')}
            </div>
          </div>
          <ModelPicker
            items={imageGenItems}
            selectedId={currentImageGen}
            allowFollowDefault
            disabled={disabled}
            align="end"
            triggerClassName="w-60"
            labels={pickerLabels}
            onSelect={item => void onUpdate({ imageGen: item.id })}
            onSelectFollowDefault={() => void onUpdate({ imageGen: '' })}
          />
        </div>
      </div>
    </section>
  );
}
