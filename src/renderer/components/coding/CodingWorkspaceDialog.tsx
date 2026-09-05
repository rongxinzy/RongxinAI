import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Bot, Folder, FolderPlus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  CodingAgentProfileId,
  type CodingAgentProfile,
  type CodingWorkspaceSummary,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingAgentStatusI18nKey } from './constants';

interface CodingWorkspaceDialogProps {
  open: boolean;
  workspace?: CodingWorkspaceSummary | null;
  profiles: CodingAgentProfile[];
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    name: string;
    sourceFolders: string[];
    defaultProfileId: string;
  }) => Promise<boolean>;
}

export const CodingWorkspaceDialog = ({
  open,
  workspace,
  profiles,
  error,
  onOpenChange,
  onSubmit,
}: CodingWorkspaceDialogProps) => {
  const [name, setName] = useState('');
  const [sourceFolders, setSourceFolders] = useState<string[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string>(CodingAgentProfileId.Builtin);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(workspace?.name ?? '');
    setSourceFolders(workspace?.sources.map(source => source.path) ?? []);
    setDefaultProfileId(workspace?.defaultProfileId ?? CodingAgentProfileId.Builtin);
  }, [open, workspace]);

  const addFolder = async () => {
    const result = await window.electron.dialog.selectDirectory({
      defaultPath: sourceFolders.at(-1),
    });
    const selectedPath = result?.path;
    if (selectedPath && !sourceFolders.includes(selectedPath)) {
      setSourceFolders(current => [...current, selectedPath]);
      if (!name.trim()) setName(selectedPath.split(/[\\/]/).filter(Boolean).at(-1) ?? '');
    }
  };

  const submit = async () => {
    if (!name.trim() || sourceFolders.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      if (await onSubmit({ name: name.trim(), sourceFolders, defaultProfileId })) {
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {i18nService.t(workspace ? 'codingWorkspaceEdit' : 'codingWorkspaceCreate')}
          </DialogTitle>
          <DialogDescription>{i18nService.t('codingWorkspaceDescription')}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="coding-workspace-name">
              {i18nService.t('codingWorkspaceName')}
            </FieldLabel>
            <Input
              id="coding-workspace-name"
              autoFocus
              value={name}
              placeholder={i18nService.t('codingWorkspaceNamePlaceholder')}
              onChange={event => setName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') void submit();
              }}
            />
          </Field>
          <Field>
            <FieldLabel>{i18nService.t('codingWorkspaceDefaultAgent')}</FieldLabel>
            <Select
              value={defaultProfileId}
              onValueChange={value => value && setDefaultProfileId(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {profiles.find(profile => profile.id === defaultProfileId)?.name ??
                    i18nService.t('codingAgentChooseAgent')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {profiles.map(profile => (
                  <SelectItem key={profile.id} value={profile.id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <Bot className="size-4 shrink-0" />
                      <span className="truncate">{profile.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {i18nService.t(CodingAgentStatusI18nKey[profile.status])}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{i18nService.t('codingWorkspaceSources')}</FieldLabel>
            <div className="overflow-hidden rounded-lg border border-border">
              {sourceFolders.map((source, index) => (
                <div
                  key={source}
                  className="flex min-h-11 items-center gap-2 border-b border-border px-3 last:border-b-0"
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={source}>
                    {source}
                  </span>
                  {index === 0 && sourceFolders.length > 1 ? (
                    <span className="text-xs text-muted-foreground">
                      {i18nService.t('codingWorkspacePrimary')}
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={i18nService.t('codingWorkspaceRemove')}
                    onClick={() =>
                      setSourceFolders(current => current.filter(candidate => candidate !== source))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                className="theme-control-sizing-9 w-full justify-start"
                onClick={() => void addFolder()}
              >
                <FolderPlus />
                {i18nService.t('codingWorkspaceAddSource')}
              </Button>
            </div>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {i18nService.t('codingWorkspaceCancel')}
          </Button>
          <Button
            type="button"
            disabled={!name.trim() || sourceFolders.length === 0 || !defaultProfileId || submitting}
            onClick={() => void submit()}
          >
            {i18nService.t('codingWorkspaceSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
