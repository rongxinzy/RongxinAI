import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Label } from '@shared/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/components/ui/radio-group';
import { Slider } from '@shared/components/ui/slider';
import type { SystemMemorySnapshot } from '../../../../shared/hardware';
import {
  LlamaCppMemoryPolicy,
  type LlamaCppMemoryPolicy as LlamaCppMemoryPolicyType,
} from '../../../../shared/llamacpp';
import { Gauge, MemoryStick } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import { localInferenceCompactButtonClass } from '../constants';
import { LLAMACPP_MEMORY_BUDGET_PERCENT } from '../hooks/useLocalInferenceMemorySettings';

type LocalInferenceMemorySettingsDialogProps = {
  isOpen: boolean;
  saving: boolean;
  policy: LlamaCppMemoryPolicyType;
  memoryBudgetPercent: number;
  systemMemorySnapshot: SystemMemorySnapshot | null;
  onPolicyChange: (policy: LlamaCppMemoryPolicyType) => void;
  onMemoryBudgetPercentChange: (percent: number) => void;
  onClose: () => void;
  onSave: () => void;
};

export function LocalInferenceMemorySettingsDialog({
  isOpen,
  saving,
  policy,
  memoryBudgetPercent,
  systemMemorySnapshot,
  onPolicyChange,
  onMemoryBudgetPercentChange,
  onClose,
  onSave,
}: LocalInferenceMemorySettingsDialogProps) {
  const isManual = policy === LlamaCppMemoryPolicy.Manual;
  const budgetMiB = systemMemorySnapshot?.available
    ? Math.floor(systemMemorySnapshot.totalMemoryMiB * (memoryBudgetPercent / 100))
    : null;
  const totalMemoryMiB = systemMemorySnapshot?.available
    ? systemMemorySnapshot.totalMemoryMiB
    : null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="w-[min(32rem,calc(100%-2rem))] gap-4 sm:max-w-lg">
        <DialogHeader className="theme-control-sizing-19 gap-1">
          <DialogTitle>{i18nService.t('localInferenceMemorySettings')}</DialogTitle>
        </DialogHeader>

        <RadioGroup
          value={policy}
          onValueChange={nextValue => onPolicyChange(nextValue as LlamaCppMemoryPolicyType)}
          className="gap-2"
          disabled={saving}
        >
          <Label
            htmlFor="llamacpp-memory-policy-auto"
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50"
          >
            <RadioGroupItem
              id="llamacpp-memory-policy-auto"
              value={LlamaCppMemoryPolicy.Auto}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Gauge className="size-4" />
                {i18nService.t('localInferenceMemoryPolicyAuto')}
              </span>
              <span className="text-sm text-muted-foreground">
                {i18nService.t('localInferenceMemoryPolicyAutoHint')}
              </span>
            </span>
          </Label>
          <Label
            htmlFor="llamacpp-memory-policy-manual"
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50"
          >
            <RadioGroupItem
              id="llamacpp-memory-policy-manual"
              value={LlamaCppMemoryPolicy.Manual}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <MemoryStick className="size-4" />
                {i18nService.t('localInferenceMemoryPolicyManual')}
              </span>
              <span className="text-sm text-muted-foreground">
                {i18nService.t('localInferenceMemoryPolicyManualHint')}
              </span>
            </span>
          </Label>
        </RadioGroup>

        {isManual ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <Label
                htmlFor="llamacpp-memory-budget"
                className="text-sm font-medium text-foreground"
              >
                {i18nService.t('localInferenceMemoryBudgetPercent')}
              </Label>
              <span className="text-sm font-medium text-foreground">{memoryBudgetPercent}%</span>
            </div>
            <Slider
              id="llamacpp-memory-budget"
              className="cursor-pointer"
              min={LLAMACPP_MEMORY_BUDGET_PERCENT.Min}
              max={LLAMACPP_MEMORY_BUDGET_PERCENT.Max}
              step={LLAMACPP_MEMORY_BUDGET_PERCENT.Step}
              value={memoryBudgetPercent}
              onValueChange={onMemoryBudgetPercentChange}
              disabled={saving}
            />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>
                {budgetMiB === null || totalMemoryMiB === null
                  ? i18nService.t('localInferenceMemoryUnavailable')
                  : i18nService
                      .t('localInferenceMemoryBudgetCalculated')
                      .replace('{total}', formatMemoryMiB(totalMemoryMiB))
                      .replace('{budget}', formatMemoryMiB(budgetMiB))}
              </span>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className={localInferenceCompactButtonClass}
            onClick={onClose}
            disabled={saving}
          >
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={localInferenceCompactButtonClass}
            onClick={onSave}
            disabled={saving}
          >
            {i18nService.t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatMemoryMiB(value: number): string {
  const gib = value / 1024;
  const digits = gib >= 10 || Number.isInteger(gib) ? 0 : 1;
  return `${gib.toFixed(digits)} GB`;
}
