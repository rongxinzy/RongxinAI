import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { FolderOpen, FolderUp, Settings2 } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';
import { localInferenceMutedTextClass } from '../constants';

type ModelLibrarySettingsModalProps = {
  isOpen: boolean;
  modelsDir: string;
  draftModelsDir: string;
  saving: boolean;
  onClose: () => void;
  onChangeModelsDir: (value: string) => void;
  onPickDirectory: () => void;
  onOpenDirectory: () => void;
  onSave: () => void;
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
  onSave,
}: ModelLibrarySettingsModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="w-full max-w-xl rounded-2xl border border-border bg-surface p-0 shadow-2xl"
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-start gap-3">
          <div className="inline-flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Settings2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('localInferenceLibrarySettings')}
            </h2>
            <p className={`mt-1 text-sm ${localInferenceMutedTextClass}`}>
              {i18nService.t('localInferenceLibraryDirectoryHint')}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {i18nService.t('localInferenceLibraryDirectory')}
          </label>
          <Input
            value={draftModelsDir}
            onChange={event => onChangeModelsDir(event.target.value)}
            placeholder={modelsDir}
            disabled={saving}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPickDirectory}
              disabled={saving}
            >
              <FolderOpen data-icon="inline-start" />
              {i18nService.t('localInferenceChangeDirectory')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenDirectory}
              disabled={saving}
            >
              <FolderUp data-icon="inline-start" />
              {i18nService.t('localInferenceOpenLibraryDirectory')}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={saving || !draftModelsDir.trim()}
          >
            {i18nService.t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
