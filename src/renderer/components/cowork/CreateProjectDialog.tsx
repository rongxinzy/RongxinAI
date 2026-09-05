import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
  /** Called with the newly created project directory path */
  onCreated: (path: string) => void;
}

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/;

const showToast = (message: string) => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

/**
 * 「创建项目」dialog: creates a new empty project directory under a base path
 * (default: <Documents>/ZhiYuanAgent/Workspaces) and hands the new path back
 * to the folder-selection flow.
 */
const CreateProjectDialog: React.FC<CreateProjectDialogProps> = ({
  open,
  onOpenChange,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [baseDir, setBaseDir] = useState('');
  const [nameError, setNameError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Reset the form and load the default base path each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setName('');
    setNameError('');
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
      if (result.success && result.path) setBaseDir(result.path);
    } catch (error) {
      console.error('[CreateProjectDialog] Failed to select directory:', error);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError(i18nService.t('projectNameRequired'));
      return;
    }
    if (ILLEGAL_NAME_CHARS.test(trimmedName) || trimmedName === '.' || trimmedName === '..') {
      setNameError(i18nService.t('projectNameInvalid'));
      return;
    }
    setNameError('');
    setIsSaving(true);
    try {
      const result = await window.electron.project.createDirectory({
        name: trimmedName,
        baseDir: baseDir || undefined,
      });
      if (result.success && result.path) {
        onOpenChange(false);
        onCreated(result.path);
      } else if (result.code === 'already-exists') {
        showToast(i18nService.t('projectAlreadyExists'));
      } else if (result.code === 'invalid-name') {
        setNameError(i18nService.t('projectNameInvalid'));
      } else {
        showToast(i18nService.t('projectCreateFailed'));
      }
    } catch (error) {
      console.error('[CreateProjectDialog] Failed to create project directory:', error);
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
            <Label htmlFor="create-project-name">
              {i18nService.t('projectNameLabel')}
              <span className="text-destructive"> *</span>
            </Label>
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
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className={localInferenceCompactButtonClass}
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
