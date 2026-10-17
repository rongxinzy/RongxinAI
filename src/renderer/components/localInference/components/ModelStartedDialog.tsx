import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import React from 'react';

import { i18nService } from '../../../services/i18n';
import { localInferenceCompactButtonClass } from '../constants';

type ModelStartedDialogProps = {
  startedModelName: string | null;
  onClose: () => void;
  onOpenModelSettings: () => void;
};

/** Confirmation shown right after a local model starts, offering model settings. */
export const ModelStartedDialog: React.FC<ModelStartedDialogProps> = ({
  startedModelName,
  onClose,
  onOpenModelSettings,
}) => (
  <Dialog
    open={startedModelName !== null}
    onOpenChange={open => {
      if (!open) onClose();
    }}
  >
    <DialogContent
      className="w-[min(28rem,calc(100%-2rem))] gap-4"
      disableCloseAnimation
      showCloseButton={false}
    >
      <DialogHeader className="gap-1">
        <DialogTitle className="text-center">
          {i18nService.t('localInferenceModelStartedTitle')}
        </DialogTitle>
        <DialogDescription>
          {i18nService
            .t('localInferenceModelStartedDescription')
            .replace('{name}', startedModelName ?? '')}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="theme-control-sizing-18 border-t-0">
        <Button
          type="button"
          variant="outline"
          className={localInferenceCompactButtonClass}
          onClick={onClose}
        >
          {i18nService.t('localInferenceConfigureLater')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={localInferenceCompactButtonClass}
          onClick={() => {
            onClose();
            onOpenModelSettings();
          }}
        >
          {i18nService.t('localInferenceOpenModelSettings')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
