import { Button } from '@shared/components/ui/button';
import { Slider } from '@shared/components/ui/slider';
import { useEffect, useState } from 'react';

import type { LlamaCppModel } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';
import { localInferenceMutedTextClass } from '../constants';

const CONTEXT_SLIDER_MIN = 1024;
const CONTEXT_SLIDER_STEP = 1024;
const CONTEXT_SLIDER_DEFAULT_VALUE = 32768;
const CONTEXT_SLIDER_DEFAULT_MAX = 131072;

type ModelContextSettingsModalProps = {
  isOpen: boolean;
  model: LlamaCppModel | null;
  savedContextSize?: number;
  runningContextSize?: number;
  onClose: () => void;
  onSave: (ctxSize?: number) => void;
};

export function ModelContextSettingsModal({
  isOpen,
  model,
  savedContextSize,
  runningContextSize,
  onClose,
  onSave,
}: ModelContextSettingsModalProps) {
  const [contextSize, setContextSize] = useState(CONTEXT_SLIDER_DEFAULT_VALUE);
  const [usesDefaultContext, setUsesDefaultContext] = useState(true);

  const trainedLimit = model?.trained_context_length ?? model?.details?.context_length;
  const sliderMax = getContextSliderMax(trainedLimit);
  const defaultContextSize = getContextSliderValue(undefined, runningContextSize, sliderMax);

  useEffect(() => {
    if (!isOpen) return;
    setContextSize(getContextSliderValue(savedContextSize, runningContextSize, sliderMax));
    setUsesDefaultContext(!savedContextSize);
  }, [isOpen, runningContextSize, savedContextSize, sliderMax]);

  if (!model) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="w-full max-w-lg rounded-2xl border border-border bg-surface p-0 shadow-2xl"
    >
      <div className="flex flex-col gap-5 p-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {i18nService.t('localInferenceConfigureContext')}
          </h2>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 text-sm font-medium text-foreground">
            {i18nService.t('localInferenceLaunchNumCtx')}
            <span>{formatContextPreset(contextSize)}</span>
          </div>
          <Slider
            aria-label={i18nService.t('localInferenceLaunchNumCtx')}
            min={CONTEXT_SLIDER_MIN}
            max={sliderMax}
            step={CONTEXT_SLIDER_STEP}
            value={contextSize}
            onValueChange={nextContextSize => {
              setContextSize(nextContextSize);
              setUsesDefaultContext(false);
            }}
          />
          <div className={`flex items-center justify-between text-xs ${localInferenceMutedTextClass}`}>
            <span>{formatContextPreset(CONTEXT_SLIDER_MIN)}</span>
            <span>{formatContextPreset(sliderMax)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setContextSize(defaultContextSize);
              setUsesDefaultContext(true);
            }}
          >
            {i18nService.t('localInferenceContextClear')}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {i18nService.t('cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => onSave(usesDefaultContext ? undefined : contextSize)}
            >
              {i18nService.t('save')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function formatContextPreset(value: number): string {
  if (value >= 1024) {
    const normalized = value / 1024;
    const display = Number.isInteger(normalized) ? normalized.toString() : normalized.toFixed(1);
    return `${display}K`;
  }
  return String(value);
}

function getContextSliderMax(trainedLimit?: number): number {
  return Math.max(CONTEXT_SLIDER_MIN + CONTEXT_SLIDER_STEP, trainedLimit ?? CONTEXT_SLIDER_DEFAULT_MAX);
}

function getContextSliderValue(
  preferredContextSize: number | undefined,
  fallbackContextSize: number | undefined,
  max: number,
): number {
  const candidate = preferredContextSize ?? fallbackContextSize ?? CONTEXT_SLIDER_DEFAULT_VALUE;
  const bounded = Math.min(Math.max(candidate, CONTEXT_SLIDER_MIN), max);
  return Math.round(bounded / CONTEXT_SLIDER_STEP) * CONTEXT_SLIDER_STEP;
}
