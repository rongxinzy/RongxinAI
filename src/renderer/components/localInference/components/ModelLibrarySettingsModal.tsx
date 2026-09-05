import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';
import { FolderOpen, FolderUp, Settings2 } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import { localInferenceCompactButtonClass } from '../constants';

type ModelLibrarySettingsModalProps = {
  isOpen: boolean;
  modelsDir: string;
  draftModelsDir: string;
  saving: boolean;
  onClose: () => void;
  onChangeModelsDir: (value: string) => void;
  onPickDirectory: () => void;
  onOpenDirectory: () => void;
};

export function ModelLibrarySettingsModal({
  isOpen,
  modelsDir,
  draftModelsDir,
  saving,
  onClose,
  onChangeModelsDir,
  onPickDirectory,
  onOpenDirectory,
}: ModelLibrarySettingsModalProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="w-[min(32rem,calc(100%-2rem))] max-h-[80vh] gap-4 overflow-y-auto sm:max-w-lg">
        <DialogHeader className="theme-control-sizing-19 gap-1">
          <div className="flex items-start gap-3">
            <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Settings2 className="size-4" />
            </div>
            <div className="min-w-0">
              <DialogTitle>{i18nService.t('localInferenceLibrarySettings')}</DialogTitle>
              <DialogDescription className="mt-1">
                {i18nService.t('localInferenceLibraryDirectoryHint')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Input
              id="llamacpp-model-library-directory"
              value={draftModelsDir}
              onChange={event => onChangeModelsDir(event.target.value)}
              placeholder={modelsDir}
              disabled={saving}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className={localInferenceCompactButtonClass}
                onClick={onPickDirectory}
                disabled={saving}
              >
                <FolderOpen data-icon="inline-start" />
                {i18nService.t('localInferenceChangeDirectory')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={localInferenceCompactButtonClass}
                onClick={onOpenDirectory}
                disabled={saving}
              >
                <FolderUp data-icon="inline-start" />
                {i18nService.t('localInferenceOpenLibraryDirectory')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
