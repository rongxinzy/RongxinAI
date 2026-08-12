import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import type { Workspace } from '@shared/workspace';
import React from 'react';

import { i18nService } from '../../services/i18n';

interface ChannelWorkspaceFieldProps {
  accountId: string;
  workspaceId: string;
  workspaces: Workspace[];
  onChange: (workspaceId: string) => void;
}

export const ChannelWorkspaceField: React.FC<ChannelWorkspaceFieldProps> = ({
  accountId,
  workspaceId,
  workspaces,
  onChange,
}) => {
  const inputId = `channel-workspace-${accountId}`;
  const visibleWorkspaces = workspaces.filter(workspace => !workspace.isHidden);

  return (
    <Field data-invalid={!workspaceId || undefined}>
      <FieldLabel htmlFor={inputId}>{i18nService.t('imChannelWorkspace')}</FieldLabel>
      <Select value={workspaceId} onValueChange={value => onChange(value ?? '')}>
        <SelectTrigger id={inputId} className="w-full" aria-invalid={!workspaceId}>
          <SelectValue placeholder={i18nService.t('imChannelWorkspacePlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {visibleWorkspaces.map(workspace => (
              <SelectItem key={workspace.id} value={workspace.id}>
                {workspace.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription className="text-xs">
        {i18nService.t('imChannelWorkspaceHint')}
      </FieldDescription>
    </Field>
  );
};
