import { Button } from '@shared/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Bot, Folder, Settings2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  CodingAgentProfileStatus,
  type CodingAgentProfile,
  type CodingWorkspaceSummary,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { canStartCodingSession } from './codingSessionDraft';

interface CodingSessionSetupDialogProps {
  workspace: CodingWorkspaceSummary;
  profiles: CodingAgentProfile[];
  onCancel: () => void;
  onManageAgents: () => void;
  onSubmit: (input: { profileId: string; sourceRoot: string }) => void;
}

export const CodingSessionSetupDialog = ({
  workspace,
  profiles,
  onCancel,
  onManageAgents,
  onSubmit,
}: CodingSessionSetupDialogProps) => {
  const selectableProfiles = useMemo(() => profiles.filter(canStartCodingSession), [profiles]);
  const [profileId, setProfileId] = useState('');
  const [sourceRoot, setSourceRoot] = useState('');
  const selectedProfile = selectableProfiles.find(profile => profile.id === profileId);

  useEffect(() => {
    setProfileId(
      selectableProfiles.some(
        profile =>
          profile.id === workspace.defaultProfileId &&
          profile.status === CodingAgentProfileStatus.Ready,
      )
        ? workspace.defaultProfileId
        : '',
    );
    setSourceRoot(workspace.sources[0]?.path ?? workspace.primaryRoot);
  }, [selectableProfiles, workspace]);

  const submit = () => {
    if (!profileId || !sourceRoot) return;
    onSubmit({ profileId, sourceRoot });
  };

  return (
    <section
      className="theme-surface-session-overlay absolute inset-0 z-20 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="false"
      aria-labelledby="coding-session-setup-title"
    >
      <div className="relative grid w-full max-w-md gap-4 rounded-xl border border-border bg-surface p-4 text-sm text-surface-foreground shadow-lg">
        <div className="flex flex-col gap-2 pr-8">
          <h2 id="coding-session-setup-title" className="text-base leading-none font-medium">
            {i18nService.t('codingSessionSetupTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {i18nService.t('codingSessionSetupDescription')}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2"
          aria-label={i18nService.t('codingWorkspaceCancel')}
          onClick={onCancel}
        >
          <X />
        </Button>
        <FieldGroup>
          {selectableProfiles.length > 0 ? (
            <Field>
              <FieldLabel>{i18nService.t('codingAgentChooseAgent')}</FieldLabel>
              <Select value={profileId} onValueChange={value => value && setProfileId(value)}>
                <SelectTrigger
                  className="w-full"
                  aria-label={i18nService.t('codingAgentChooseAgent')}
                >
                  <Bot className="size-4 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder={i18nService.t('codingAgentChooseAgent')}>
                    {selectedProfile?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {selectableProfiles.map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{i18nService.t('codingSessionAgentBinding')}</FieldDescription>
            </Field>
          ) : (
            <FieldDescription>{i18nService.t('codingSessionNoReadyAgent')}</FieldDescription>
          )}
          {workspace.sources.length > 1 ? (
            <Field>
              <FieldLabel>{i18nService.t('codingSessionSource')}</FieldLabel>
              <Select value={sourceRoot} onValueChange={value => value && setSourceRoot(value)}>
                <SelectTrigger className="w-full" aria-label={i18nService.t('codingSessionSource')}>
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workspace.sources.map(source => (
                    <SelectItem key={source.id} value={source.path}>
                      {source.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </FieldGroup>
        <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl p-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            {i18nService.t('codingWorkspaceCancel')}
          </Button>
          {selectableProfiles.length > 0 ? (
            <Button type="button" disabled={!profileId || !sourceRoot} onClick={submit}>
              {i18nService.t('codingSessionConfirm')}
            </Button>
          ) : (
            <Button type="button" onClick={onManageAgents}>
              <Settings2 data-icon="inline-start" />
              {i18nService.t('codingAgentManageAgents')}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
};
