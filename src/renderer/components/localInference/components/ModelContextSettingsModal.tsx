import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { useEffect, useMemo, useState } from 'react';

import type { LlamaCppModel } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';
import { localInferenceMutedTextClass } from '../constants';

const CONTEXT_PRESETS = [4096, 8192, 16384, 32768];

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
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setValue(savedContextSize ? String(savedContextSize) : '');
  }, [isOpen, savedContextSize]);

  const trainedLimit = model?.trained_context_length ?? model?.details?.context_length;
  const parsedValue = value.trim() ? Number.parseInt(value.trim(), 10) : undefined;
  const contextError = useMemo(() => {
    if (!value.trim()) return null;
    if (!parsedValue || !Number.isFinite(parsedValue) || parsedValue <= 0) {
      return i18nService.t('localInferenceContextInvalid');
    }
    if (trainedLimit && parsedValue > trainedLimit) {
      return i18nService.t('localInferenceLaunchContextExceedsTrainingLimit')
        .replace('{requested}', String(parsedValue))
        .replace('{trained}', String(trainedLimit));
    }
    return null;
  }, [parsedValue, trainedLimit, value]);

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
          <p className={`mt-1 text-sm ${localInferenceMutedTextClass}`}>
            {model.name}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {savedContextSize ? (
            <Badge variant="secondary">
              {i18nService.t('localInferenceContextConfigured').replace('{value}', formatContextPreset(savedContextSize))}
            </Badge>
          ) : (
            <Badge variant="outline">{i18nService.t('localInferenceContextDefaultValue')}</Badge>
          )}
          {runningContextSize ? (
            <Badge variant="outline">
              {i18nService.t('localInferenceContextRunning').replace('{value}', formatContextPreset(runningContextSize))}
            </Badge>
          ) : null}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {i18nService.t('localInferenceLaunchNumCtx')}
          </label>
          <Input
            type="number"
            min={1}
            step={1}
            value={value}
            onChange={event => setValue(event.target.value)}
            placeholder={i18nService.t('localInferenceContextDefaultValue')}
          />
          <p className={`text-xs ${localInferenceMutedTextClass}`}>
            {i18nService.t('localInferenceContextSettingsHint')}
          </p>
          {contextError ? (
            <p className="text-xs text-destructive">{contextError}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {CONTEXT_PRESETS.map(preset => (
            <Button
              key={preset}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setValue(String(preset))}
            >
              {formatContextPreset(preset)}
            </Button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setValue('')}
          >
            {i18nService.t('localInferenceContextReset')}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {i18nService.t('cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={Boolean(contextError)}
              onClick={() => onSave(parsedValue)}
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
