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
import { Folder, FolderOpen, FolderPlus, LoaderCircle, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { WorkspaceSidebarNode } from './types';

interface EditProjectDialogProps {
  workspace: WorkspaceSidebarNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Returns whether the update was persisted. */
  onSave: (id: string, values: { name: string; folders: string[] }) => Promise<boolean>;
  /** Requests removal; the parent owns the destructive confirm flow. */
  onRemove: (workspace: WorkspaceSidebarNode) => void;
}

const showToast = (message: string) => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

const openInFileExplorer = (folderPath: string) => {
  void window.electron.shell.openPath(folderPath).then(result => {
    if (!result.success) {
      console.warn('[EditProjectDialog] Failed to open folder in file explorer:', result.error);
    }
  });
};

/**
 * 「编辑项目」dialog: rename the workspace and manage its source folders
 * (primary path stays the session working directory; attached folders are
 * extra roots shown here and openable from the file explorer).
 */
const EditProjectDialog: React.FC<EditProjectDialogProps> = ({
  workspace,
  open,
  onOpenChange,
  onSave,
  onRemove,
}) => {
  const [name, setName] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [nameError, setNameError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || !workspace) return;
    setName(workspace.name);
    setFolders(workspace.folders ?? []);
    setNameError('');
    setIsSaving(false);
  }, [open, workspace]);

  const handleAddFolder = useCallback(async () => {
    try {
      const result = await window.electron.dialog.selectDirectory();
      if (!result.success || !result.path) return;
      const selected = result.path.trim();
      const pathsEqual = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
      if (!workspace || pathsEqual(selected, workspace.path)) return;
      setFolders(current =>
        current.some(folder => pathsEqual(folder, selected)) ? current : [...current, selected],
      );
    } catch (error) {
      console.error('[EditProjectDialog] Failed to select directory:', error);
    }
  }, [workspace]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError(i18nService.t('projectNameRequired'));
      return;
    }
    if (!workspace) return;
    setNameError('');
    setIsSaving(true);
    try {
      const saved = await onSave(workspace.id, { name: trimmedName, folders });
      if (!saved) {
        showToast(i18nService.t('editProjectFailed'));
        return;
      }
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }, [name, folders, workspace, onSave, onOpenChange]);

  const primaryPath = workspace?.path ?? '';

  return (
    <Dialog open={open} onOpenChange={nextOpen => !isSaving && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{i18nService.t('editProject')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Input
              id="edit-project-name"
              value={name}
              onChange={event => {
                setName(event.target.value);
                if (nameError) setNameError('');
              }}
              placeholder={i18nService.t('projectNameLabel')}
              disabled={isSaving}
              autoFocus
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium text-foreground">
              {i18nService.t('projectPathLabel')}
            </Label>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex h-11 items-center gap-3 border-border px-3">
                <Folder className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-sm" title={primaryPath}>
                  {primaryPath}
                </span>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {i18nService.t('primaryFolder')}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => openInFileExplorer(primaryPath)}
                  aria-label={i18nService.t('openInFileExplorer')}
                >
                  <FolderOpen className="size-4" strokeWidth={1.75} />
                </Button>
              </div>
              {folders.map(folder => (
                <div
                  key={folder}
                  className="flex h-11 items-center gap-3 border-t border-border px-3"
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate text-sm" title={folder}>
                    {folder}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => openInFileExplorer(folder)}
                    aria-label={i18nService.t('openInFileExplorer')}
                  >
                    <FolderOpen className="size-4" strokeWidth={1.75} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setFolders(current => current.filter(item => item !== folder))}
                    disabled={isSaving}
                    aria-label={i18nService.t('delete')}
                  >
                    <X className="size-4" strokeWidth={1.75} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleAddFolder()}
                disabled={isSaving}
                className="h-11 w-full justify-start gap-3 rounded-none border-t border-border px-3 text-sm font-medium"
              >
                <FolderPlus className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                {i18nService.t('addFolder')}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter surface={DialogFooterSurface.Seamless}>
          <Button
            type="button"
            variant="destructive"
            className="mr-auto"
            onClick={() => {
              if (!workspace) return;
              onOpenChange(false);
              onRemove(workspace);
            }}
            disabled={isSaving}
          >
            {i18nService.t('removeProject')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="theme-confirm-cancel min-w-16"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {i18nService.t('cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving && <LoaderCircle className="size-4 animate-spin" />}
            {i18nService.t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditProjectDialog;
