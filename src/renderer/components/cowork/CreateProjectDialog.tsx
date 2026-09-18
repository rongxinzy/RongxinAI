import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogFooterSurface,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { localInferenceCompactButtonClass } from '../localInference/constants';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the selected project directory and its independent display name. */
  onCreated: (path: string, name: string) => Promise<boolean>;
}

const showToast = (message: string) => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

/**
 * 「创建项目」dialog: registers the selected project directory with an
 * independent display name for the folder-selection flow.
 */
const CreateProjectDialog: React.FC<CreateProjectDialogProps> = ({
  open,
  onOpenChange,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [baseDir, setBaseDir] = useState('');
  const [nameError, setNameError] = useState('');
  const [pathError, setPathError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Reset the form and load the default base path each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setName('');
    setNameError('');
    setPathError('');
    setIsSaving(false);
    let cancelled = false;
    void window.electron.project.getDefaultBaseDir().then(result => {
      if (!cancelled && result.success && result.path) setBaseDir(result.path);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleBrowse = useCallback(async () => {
    try {
      const result = await window.electron.dialog.selectDirectory();
      if (result.success && result.path) {
        setBaseDir(result.path);
        setPathError('');
      }
    } catch (error) {
      console.error('[CreateProjectDialog] Failed to select directory:', error);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    const selectedPath = baseDir.trim();
    if (!trimmedName) {
      setNameError(i18nService.t('projectNameRequired'));
      return;
    }
    if (!selectedPath) {
      setPathError(i18nService.t('projectPathRequired'));
      return;
    }
    setNameError('');
    setPathError('');
    setIsSaving(true);
    try {
      const created = await onCreated(selectedPath, trimmedName);
      if (!created) {
        showToast(i18nService.t('projectCreateFailed'));
        return;
      }
      onOpenChange(false);
    } catch (error) {
      console.error('[CreateProjectDialog] Failed to create project:', error);
      showToast(i18nService.t('projectCreateFailed'));
    } finally {
      setIsSaving(false);
    }
  }, [name, baseDir, onCreated, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={nextOpen => !isSaving && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{i18nService.t('createProjectTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <Input
              id="create-project-name"
              value={name}
              onChange={event => {
                setName(event.target.value);
                if (nameError) setNameError('');
              }}
              placeholder={i18nService.t('createProjectNamePlaceholder')}
              disabled={isSaving}
              autoFocus
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-project-path">
              {i18nService.t('projectPathLabel')}
              <span className="text-destructive"> *</span>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="create-project-path"
                value={baseDir}
                readOnly
                disabled={isSaving}
                className="theme-page-create-project-dialog-input-1 flex-1 truncate"
              />
              <Button
                type="button"
                variant="outline"
                className={localInferenceCompactButtonClass}
                onClick={() => void handleBrowse()}
                disabled={isSaving}
              >
                <FolderOpen className="size-4" />
                {i18nService.t('browse')}
              </Button>
            </div>
            {pathError && <p className="text-xs text-destructive">{pathError}</p>}
          </div>
        </div>
        <DialogFooter surface={DialogFooterSurface.Seamless}>
          <Button
            type="button"
            variant="ghost"
            className="theme-confirm-cancel min-w-16"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={localInferenceCompactButtonClass}
            onClick={() => void handleSave()}
            disabled={isSaving}
          >
            {isSaving && <LoaderCircle className="size-4 animate-spin" />}
            {i18nService.t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateProjectDialog;
