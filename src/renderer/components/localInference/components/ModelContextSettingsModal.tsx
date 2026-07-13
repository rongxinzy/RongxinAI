import { Button } from '@shared/components/ui/button';
import { Slider } from '@shared/components/ui/slider';
import { useEffect, useMemo, useState } from 'react';

import type { LlamaCppModel } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';
import { localInferenceMutedTextClass } from '../constants';

const CONTEXT_SLIDER_DEFAULT_VALUE = 32768;
const CONTEXT_SLIDER_DEFAULT_MAX = 262144;
const CONTEXT_PRESETS = [4096, 8192, 16384, 32768, 65536, 131072, 262144] as const;

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

  const trainedLimit = model?.trained_context_length ?? model?.details?.context_length;
  const contextPresets = useMemo(() => getContextPresets(trainedLimit), [trainedLimit]);
  const selectedPresetIndex = contextPresets.indexOf(contextSize);

  useEffect(() => {
    if (!isOpen) return;
    setContextSize(getContextPresetValue(savedContextSize, runningContextSize, contextPresets));
  }, [contextPresets, isOpen, runningContextSize, savedContextSize]);

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

        <div className="flex flex-col gap-3">
          <Slider
            aria-label={i18nService.t('localInferenceConfigureContext')}
            min={0}
            max={contextPresets.length - 1}
            step={1}
            value={Math.max(0, selectedPresetIndex)}
            onValueChange={nextPresetIndex => setContextSize(contextPresets[nextPresetIndex] ?? contextPresets[0])}
          />
          <div
            className={`grid text-center text-xs ${localInferenceMutedTextClass}`}
            style={{ gridTemplateColumns: `repeat(${contextPresets.length}, minmax(0, 1fr))` }}
          >
            {contextPresets.map(preset => (
              <span key={preset}>{formatContextPreset(preset)}</span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {i18nService.t('cancel')}
          </Button>
          <Button type="button" size="sm" onClick={() => onSave(contextSize)}>
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

function getContextPresets(trainedLimit?: number): readonly number[] {
  const limit = trainedLimit ?? CONTEXT_SLIDER_DEFAULT_MAX;
  const presets = CONTEXT_PRESETS.filter(preset => preset <= limit);
  return presets.length > 0 ? presets : [Math.max(1, limit)];
}

function getContextPresetValue(
  preferredContextSize: number | undefined,
  fallbackContextSize: number | undefined,
  contextPresets: readonly number[],
): number {
  const candidate = preferredContextSize ?? fallbackContextSize ?? CONTEXT_SLIDER_DEFAULT_VALUE;
  return contextPresets.reduce((closest, preset) =>
    Math.abs(preset - candidate) < Math.abs(closest - candidate) ? preset : closest,
  );
}
