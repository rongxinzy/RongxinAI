import { Button } from '@shared/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@shared/components/ui/input-group';
import { Slider } from '@shared/components/ui/slider';
import { cn } from '@shared/lib/utils';
import { useEffect, useMemo, useState } from 'react';

import type { LlamaCppModel } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';
import { localInferenceMutedTextClass } from '../constants';

const CONTEXT_SLIDER_DEFAULT_VALUE = 32768;
const CONTEXT_SLIDER_DEFAULT_MAX = 131072;
const TOKENS_PER_K = 1024;
const CONTEXT_PRESETS = [4096, 8192, 16384, 32768, 65536, 131072] as const;

type ModelContextSettingsModalProps = {
  isOpen: boolean;
  model: LlamaCppModel | null;
  savedContextSize?: number;
  runningContextSize?: number;
  onClose: () => void;
  onSave: (ctxSize?: number) => void;
  onValidationError: (message: string) => void;
};

export function ModelContextSettingsModal({
  isOpen,
  model,
  savedContextSize,
  runningContextSize,
  onClose,
  onSave,
  onValidationError,
}: ModelContextSettingsModalProps) {
  const [contextSize, setContextSize] = useState(CONTEXT_SLIDER_DEFAULT_VALUE);
  const [customContextValue, setCustomContextValue] = useState<string | null>(null);

  const trainedLimit = model?.trained_context_length ?? model?.details?.context_length;
  const contextPresets = useMemo(() => getContextPresets(trainedLimit), [trainedLimit]);
  const selectedPresetIndex = contextPresets.indexOf(contextSize);
  const customSliderIndex = contextPresets.length;
  const sliderLabelCount = contextPresets.length + 1;
  const sliderValue =
    customContextValue !== null ? customSliderIndex : Math.max(0, selectedPresetIndex);
  const parsedCustomContextK = customContextValue?.trim()
    ? Number(customContextValue.trim())
    : undefined;
  const parsedCustomContextValue =
    parsedCustomContextK !== undefined && Number.isFinite(parsedCustomContextK)
      ? Math.round(parsedCustomContextK * TOKENS_PER_K)
      : undefined;
  const customContextError = getCustomContextError(
    parsedCustomContextValue,
    customContextValue,
    trainedLimit,
  );

  useEffect(() => {
    if (!isOpen) return;
    const initialContextSize = getInitialContextValue(
      savedContextSize,
      runningContextSize,
      contextPresets,
      trainedLimit,
    );
    setContextSize(initialContextSize);
    setCustomContextValue(
      contextPresets.includes(initialContextSize) ? null : formatContextKInput(initialContextSize),
    );
  }, [contextPresets, isOpen, runningContextSize, savedContextSize, trainedLimit]);

  if (!model) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="theme-local-context-modal w-full max-w-md p-0"
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-base font-semibold text-foreground">
            {i18nService.t('localInferenceConfigureContext')}
          </h2>
          <p className="min-w-0 truncate text-sm text-muted-foreground" title={model.name}>
            {model.name}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex min-h-7 items-center gap-0">
            <span className="text-sm font-medium text-muted-foreground">
              {i18nService.t('localInferenceServiceConfigCtxSizeLabel')}：
            </span>
            {customContextValue !== null ? (
              <InputGroup className="theme-control-sizing-22 w-fit">
                <InputGroupInput
                  type="number"
                  min={1}
                  step={1}
                  value={customContextValue}
                  aria-invalid={Boolean(customContextError)}
                  className="theme-part-model-context-settings-modal-input-group-input-1 flex-none appearance-none text-left [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  onChange={event => {
                    const nextValue = event.target.value;
                    setCustomContextValue(nextValue);
                    const nextParsedK = nextValue.trim() ? Number(nextValue.trim()) : undefined;
                    const nextParsedValue =
                      nextParsedK !== undefined && Number.isFinite(nextParsedK)
                        ? Math.round(nextParsedK * TOKENS_PER_K)
                        : undefined;
                    if (
                      !getCustomContextError(nextParsedValue, nextValue, trainedLimit) &&
                      nextParsedValue
                    ) {
                      setContextSize(nextParsedValue);
                    }
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText className="theme-part-model-context-settings-modal-input-group-text-1">
                    K
                  </InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            ) : (
              <output className="inline-flex h-7 items-center text-sm font-semibold leading-5 text-foreground">
                {formatContextPreset(contextSize)}
              </output>
            )}
          </div>
          {customContextValue !== null && customContextError ? (
            <p className="text-xs text-destructive">{customContextError}</p>
          ) : null}
          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-[calc(50%+4px)] z-0"
            >
              {contextPresets.map((preset, index) => (
                <span
                  key={preset}
                  className={cn(
                    'absolute h-3 w-0.5 -translate-x-1/2',
                    customContextValue === null && index === selectedPresetIndex
                      ? 'bg-primary'
                      : 'bg-border',
                  )}
                  style={{ left: `${getContextPresetPosition(index, sliderLabelCount)}%` }}
                />
              ))}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute h-3 w-0.5 -translate-x-1/2',
                  customContextValue !== null ? 'bg-primary' : 'bg-border',
                )}
                style={{ left: '100%' }}
              />
            </div>
            <Slider
              aria-label={i18nService.t('localInferenceConfigureContext')}
              min={0}
              max={customSliderIndex}
              step={1}
              value={sliderValue}
              className="relative z-10"
              onValueChange={nextPresetIndex => {
                if (nextPresetIndex === customSliderIndex) {
                  setCustomContextValue(customContextValue ?? formatContextKInput(contextSize));
                  return;
                }
                setContextSize(contextPresets[nextPresetIndex] ?? contextPresets[0]);
                setCustomContextValue(null);
              }}
            />
          </div>
          <div className={`relative h-4 text-xs ${localInferenceMutedTextClass}`}>
            {contextPresets.map((preset, index) => (
              <span
                key={preset}
                className={cn(
                  'absolute whitespace-nowrap',
                  index === 0 ? 'translate-x-0' : '-translate-x-1/2',
                )}
                style={{ left: `${getContextPresetPosition(index, sliderLabelCount)}%` }}
              >
                {formatContextPreset(preset)}
              </span>
            ))}
            <span className="absolute -translate-x-full whitespace-nowrap" style={{ left: '100%' }}>
              {i18nService.t('localInferenceContextCustom')}
            </span>
          </div>
        </div>

        {runningContextSize ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle pt-3 text-xs">
            <span>
              <span className="text-muted-foreground">
                {i18nService.t('localInferenceContextRunning').replace('{value}', '')}
              </span>
              {formatContextPreset(runningContextSize)}
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" className="min-w-16" onClick={onClose}>
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            className="min-w-16"
            onClick={() => {
              if (customContextValue !== null) {
                if (!customContextValue.trim()) {
                  onValidationError(i18nService.t('localInferenceContextInvalid'));
                  return;
                }
                if (customContextError) {
                  onValidationError(customContextError);
                  return;
                }
              }
              onSave(contextSize);
            }}
          >
            {i18nService.t('save')}
          </Button>
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

function formatContextKInput(value: number): string {
  return String(Number((value / TOKENS_PER_K).toFixed(2)));
}

function getContextPresets(trainedLimit?: number): readonly number[] {
  const limit = trainedLimit ?? CONTEXT_SLIDER_DEFAULT_MAX;
  const presets = CONTEXT_PRESETS.filter(preset => preset <= limit);
  return presets.length > 0 ? presets : [Math.max(1, limit)];
}

function getInitialContextValue(
  preferredContextSize: number | undefined,
  fallbackContextSize: number | undefined,
  contextPresets: readonly number[],
  trainedLimit?: number,
): number {
  const candidate = preferredContextSize ?? fallbackContextSize;
  if (
    candidate !== undefined &&
    Number.isInteger(candidate) &&
    candidate > 0 &&
    (!trainedLimit || candidate <= trainedLimit)
  ) {
    return candidate;
  }
  const nearestCandidate = candidate ?? CONTEXT_SLIDER_DEFAULT_VALUE;
  return contextPresets.reduce((closest, preset) =>
    Math.abs(preset - nearestCandidate) < Math.abs(closest - nearestCandidate) ? preset : closest,
  );
}

function getCustomContextError(
  parsedValue: number | undefined,
  rawValue: string | null,
  trainedLimit?: number,
): string | null {
  if (rawValue === null) return null;
  if (!rawValue.trim()) return null;
  if (parsedValue === undefined || !Number.isInteger(parsedValue) || parsedValue <= 0) {
    return i18nService.t('localInferenceContextInvalid');
  }
  if (trainedLimit && parsedValue > trainedLimit) {
    return i18nService
      .t('localInferenceLaunchContextExceedsTrainingLimit')
      .replace('{requested}', String(parsedValue))
      .replace('{trained}', String(trainedLimit));
  }
  return null;
}

function getContextPresetPosition(index: number, count: number): number {
  if (count <= 1) return 50;
  return (index / (count - 1)) * 100;
}
