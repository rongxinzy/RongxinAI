import { useMemo } from 'react';

import type {
  MagpieModelRef,
  MagpiePreferences,
  MagpiePreferencesPatch,
} from '../../../../shared/magpie/preferences';
import { i18nService } from '../../../services/i18n';
import {
  MagpieEffortSelect,
  MagpieListEditor,
  MagpieModelSelect,
  MagpiePreferenceRow,
} from './MagpiePreferenceControls';

export function MagpieModelPreferences({
  preferences,
  saving,
  update,
}: {
  preferences: MagpiePreferences;
  saving: boolean;
  update: (patch: MagpiePreferencesPatch) => Promise<boolean>;
}) {
  const searchModels = useMemo<MagpieModelRef[]>(() => {
    const result: MagpieModelRef[] = [];
    for (const choice of preferences.searchChoices) {
      if (choice.service) {
        result.push({ id: choice.id, name: choice.name });
      }
      result.push(...choice.models);
    }
    return result;
  }, [preferences.searchChoices]);
  const disabled = saving;
  const visionModel = preferences.vision
    ? preferences.visionModels.find(model => model.id === preferences.vision)
    : undefined;
  const visionCurrent =
    preferences.vision === 'off'
      ? i18nService.t('magpieOff')
      : preferences.vision
        ? visionModel
          ? `${visionModel.name || visionModel.id}${visionModel.providerName ? ` · ${visionModel.providerName}` : ''}`
          : preferences.vision
        : preferences.visionAuto
          ? `${i18nService.t('magpieAutomatic')} · ${preferences.visionAuto}`
          : i18nService.t('magpieAutomatic');
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">{i18nService.t('magpieImageSection')}</h2>
        <MagpiePreferenceRow
          title={i18nService.t('magpieImageRecognition')}
          description={
            <>
              {i18nService.t('magpieImageRecognitionHint')}
              {preferences.visionMissing ? (
                <span className="mt-1 block text-destructive">
                  {i18nService
                    .t('magpieModelMissing')
                    .replace('{model}', preferences.visionMissing)}
                </span>
              ) : null}
            </>
          }
          control={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <MagpieModelSelect
                label={i18nService.t('magpieImageRecognition')}
                value={preferences.vision}
                models={preferences.visionModels}
                allowOff
                disabled={disabled}
                onChange={vision => void update({ vision })}
              />
              {preferences.vision !== 'off' && preferences.visionEfforts.length > 0 ? (
                <MagpieEffortSelect
                  label={i18nService.t('magpieEffortDefault')}
                  value={preferences.visionEffort}
                  efforts={preferences.visionEfforts}
                  disabled={disabled}
                  onChange={visionEffort => void update({ visionEffort })}
                />
              ) : null}
            </div>
          }
        />
        <p className="text-sm text-muted-foreground">
          {i18nService.t('magpieCurrentChoice')}: {visionCurrent}
        </p>
        <MagpiePreferenceRow
          title={i18nService.t('magpieImageGeneration')}
          description={i18nService.t('magpieImageGenerationHint')}
          control={
            <MagpieModelSelect
              label={i18nService.t('magpieImageGeneration')}
              value={preferences.imageGen}
              models={preferences.imageGenModels}
              allowOff
              disabled={disabled}
              onChange={imageGen => void update({ imageGen })}
            />
          }
        />
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <h2 className="text-base font-semibold">{i18nService.t('magpieSearchSection')}</h2>
        <MagpiePreferenceRow
          title={i18nService.t('magpieWebSearchModel')}
          description={i18nService.t('magpieWebSearchModelHint')}
          control={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <MagpieModelSelect
                label={i18nService.t('magpieWebSearchModel')}
                value={preferences.searcher}
                models={searchModels}
                allowOff
                disabled={disabled || searchModels.length === 0}
                onChange={searcher => void update({ searcher })}
              />
              {preferences.searcher !== 'off' && preferences.searchEfforts.length > 0 ? (
                <MagpieEffortSelect
                  label={i18nService.t('magpieEffortDefault')}
                  value={preferences.searcherEffort}
                  efforts={preferences.searchEfforts}
                  disabled={disabled}
                  onChange={searcherEffort => void update({ searcherEffort })}
                />
              ) : null}
            </div>
          }
        />
        {preferences.searchUnused ? (
          <p className="text-sm text-muted-foreground">{preferences.searchUnused}</p>
        ) : null}
        {searchModels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{i18nService.t('magpieNoSearcher')}</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <h2 className="text-base font-semibold">{i18nService.t('magpieDisabledModels')}</h2>
        <p className="text-sm text-muted-foreground">{i18nService.t('magpieDisabledModelsHint')}</p>
        <MagpieListEditor
          values={preferences.disabledModels}
          placeholder={i18nService.t('magpieDisabledModelsPlaceholder')}
          disabled={disabled}
          onChange={disabledModels => void update({ disabledModels })}
        />
      </section>
    </div>
  );
}
