import { Button } from '@shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { useEffect, useState } from 'react';

import type { LlamaCppModel, LlamaCppModelPreference } from '../../../../shared/llamacpp';
import type { ModelCapabilities } from '../../../../shared/providers';
import { ModelCapabilityStatus } from '../../../../shared/providers';
import { i18nService } from '../../../services/i18n';
import { parseLlamaCppModelCapabilities } from '../../../services/modelCapabilityProbe';
import Modal from '../../common/Modal';
import { localInferenceCompactButtonClass, localInferenceMutedTextClass } from '../constants';

type ModelCapabilitySettingsModalProps = {
  isOpen: boolean;
  model: LlamaCppModel | null;
  preference?: LlamaCppModelPreference;
  onClose: () => void;
  onSave: (toolCalling: ModelCapabilityStatus) => void;
};

export function ModelCapabilitySettingsModal({
  isOpen,
  model,
  preference,
  onClose,
  onSave,
}: ModelCapabilitySettingsModalProps) {
  const [toolCalling, setToolCalling] = useState<ModelCapabilityStatus>(
    ModelCapabilityStatus.Unknown,
  );
  const [detectedCapabilities, setDetectedCapabilities] = useState<Partial<ModelCapabilities>>({});

  useEffect(() => {
    if (!isOpen || !model) return;

    setToolCalling(preference?.capabilities?.toolCalling ?? ModelCapabilityStatus.Unknown);
    setDetectedCapabilities({});
    void window.electron.llamacpp
      .showModel(model.name)
      .then(payload => {
        const detected = parseLlamaCppModelCapabilities(payload);
        setDetectedCapabilities(detected);
        if (preference?.capabilities?.toolCalling === undefined && detected.toolCalling) {
          setToolCalling(detected.toolCalling);
        }
      })
      .catch(() => undefined);
  }, [isOpen, model, preference?.capabilities?.toolCalling]);

  if (!model) return null;

  const imageInput = detectedCapabilities.imageInput ?? ModelCapabilityStatus.Unknown;
  const reasoning =
    model.supportsThinkingToggle === true
      ? ModelCapabilityStatus.Supported
      : model.supportsThinkingToggle === false
        ? ModelCapabilityStatus.Unsupported
        : ModelCapabilityStatus.Unknown;
  const statusLabel = (status: ModelCapabilityStatus) => {
    switch (status) {
      case ModelCapabilityStatus.Supported:
        return i18nService.t('capabilitySupported');
      case ModelCapabilityStatus.Unsupported:
        return i18nService.t('capabilityUnsupported');
      default:
        return i18nService.t('capabilityUnknown');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="w-full max-w-lg rounded-xl border border-border bg-surface p-0 shadow-xl"
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {i18nService.t('modelCapabilities')}
          </h2>
          <p className={`text-sm leading-6 ${localInferenceMutedTextClass}`}>
            {i18nService.t('modelCapabilitiesHint')}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm text-foreground">
            <span>{i18nService.t('capabilityToolCalling')}</span>
            <Select
              value={toolCalling}
              onValueChange={value => setToolCalling(value as ModelCapabilityStatus)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ModelCapabilityStatus.Supported}>
                  {i18nService.t('capabilitySupported')}
                </SelectItem>
                <SelectItem value={ModelCapabilityStatus.Unsupported}>
                  {i18nService.t('capabilityUnsupported')}
                </SelectItem>
                <SelectItem value={ModelCapabilityStatus.Unknown}>
                  {i18nService.t('capabilityUnknown')}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div className="flex min-w-0 flex-col gap-1.5 text-sm text-foreground">
            <span>{i18nService.t('imageInput')}</span>
            <Select value={imageInput} disabled>
              <SelectTrigger className="w-full">
                <SelectValue>{statusLabel(imageInput)}</SelectValue>
              </SelectTrigger>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 text-sm text-foreground">
            <span>{i18nService.t('capabilityReasoning')}</span>
            <Select value={reasoning} disabled>
              <SelectTrigger className="w-full">
                <SelectValue>{statusLabel(reasoning)}</SelectValue>
              </SelectTrigger>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className={localInferenceCompactButtonClass}
            onClick={onClose}
          >
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={localInferenceCompactButtonClass}
            onClick={() => onSave(toolCalling)}
          >
            {i18nService.t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
