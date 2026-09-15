import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Label } from '@shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { useEffect, useState } from 'react';
import {
  LlamaCppModelResidencyMode,
  type LlamaCppModel,
  type LlamaCppModelPreference,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';

const ResidencyPreset = {
  FiveMinutes: '5',
  ThirtyMinutes: '30',
  OneHour: '60',
  Forever: 'forever',
} as const;
type ResidencyPreset = (typeof ResidencyPreset)[keyof typeof ResidencyPreset];

type ModelResidencySettingsModalProps = {
  model: LlamaCppModel | null;
  preference?: LlamaCppModelPreference;
  onClose: () => void;
  onSave: (residency: NonNullable<LlamaCppModelPreference['residency']>) => void;
};

export function ModelResidencySettingsModal({
  model,
  preference,
  onClose,
  onSave,
}: ModelResidencySettingsModalProps) {
  const residency = preference?.residency;
  const initialPreset = getPreset(residency);
  const [selectedPreset, setSelectedPreset] = useState<ResidencyPreset>(initialPreset);

  useEffect(() => {
    setSelectedPreset(initialPreset);
  }, [initialPreset, model?.name]);

  if (!model) return null;

  return (
    <Dialog open={Boolean(model)} onOpenChange={open => !open && onClose()}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>{i18nService.t('localInferenceResidencyTitle')}</DialogTitle>
          <DialogDescription>{model.name}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Label htmlFor="llamacpp-model-residency">
            {i18nService.t('localInferenceResidencyDuration')}
          </Label>
          <Select
            value={selectedPreset}
            onValueChange={value => {
              setSelectedPreset(value as ResidencyPreset);
            }}
          >
            <SelectTrigger id="llamacpp-model-residency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ResidencyPreset.FiveMinutes}>
                  {i18nService.t('localInferenceResidencyFiveMinutes')}
                </SelectItem>
                <SelectItem value={ResidencyPreset.ThirtyMinutes}>
                  {i18nService.t('localInferenceResidencyThirtyMinutes')}
                </SelectItem>
                <SelectItem value={ResidencyPreset.OneHour}>
                  {i18nService.t('localInferenceResidencyOneHour')}
                </SelectItem>
                <SelectItem value={ResidencyPreset.Forever}>
                  {i18nService.t('localInferenceResidencyForever')}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              const next = resolveResidency(selectedPreset);
              if (next) onSave(next);
            }}
          >
            {i18nService.t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getPreset(residency: LlamaCppModelPreference['residency']): ResidencyPreset {
  if (residency?.mode === LlamaCppModelResidencyMode.Forever) return ResidencyPreset.Forever;
  const minutes = residency?.idleMinutes ?? 30;
  if (minutes === 5) return ResidencyPreset.FiveMinutes;
  if (minutes === 30) return ResidencyPreset.ThirtyMinutes;
  if (minutes === 60) return ResidencyPreset.OneHour;
  return ResidencyPreset.ThirtyMinutes;
}

function resolveResidency(
  preset: ResidencyPreset,
): NonNullable<LlamaCppModelPreference['residency']> | null {
  if (preset === ResidencyPreset.Forever) {
    return { mode: LlamaCppModelResidencyMode.Forever };
  }
  const idleMinutes = Number(preset);
  if (!Number.isSafeInteger(idleMinutes) || idleMinutes <= 0) return null;
  return { mode: LlamaCppModelResidencyMode.Timed, idleMinutes };
}
