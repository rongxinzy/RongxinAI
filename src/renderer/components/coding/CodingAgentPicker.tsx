import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import { Textarea } from '@shared/components/ui/textarea';
import { Bot, Plus, Settings2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import {
  CodingAgentProfileStatus,
  type AddCodingAgentProfileInput,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';

const statusKey: Record<CodingAgentProfileStatus, string> = {
  [CodingAgentProfileStatus.Detected]: 'codingAgentStatusDetected',
  [CodingAgentProfileStatus.Ready]: 'codingAgentReady',
  [CodingAgentProfileStatus.NeedsConfiguration]: 'codingAgentStatusNeedsConfiguration',
  [CodingAgentProfileStatus.NeedsAdapter]: 'codingAgentStatusNeedsAdapter',
  [CodingAgentProfileStatus.NeedsAuth]: 'codingAgentStatusNeedsAuth',
  [CodingAgentProfileStatus.Incompatible]: 'codingAgentStatusIncompatible',
  [CodingAgentProfileStatus.Untrusted]: 'codingAgentStatusUntrusted',
  [CodingAgentProfileStatus.Unavailable]: 'codingAgentStatusUnavailable',
};

interface CodingAgentPickerProps {
  profiles: CodingAgentProfile[];
  onSelect: (profileId: string) => void;
  onProbe: (profileId: string) => void;
  onAddProfile: (input: AddCodingAgentProfileInput) => Promise<boolean>;
  onTrust: (profileId: string) => Promise<boolean>;
  onAuthenticate: (profileId: string, methodId: string) => Promise<boolean>;
  onTerminalAuthenticate: (profileId: string, methodId: string) => Promise<boolean>;
}

export const CodingAgentPicker = ({
  profiles,
  onSelect,
  onProbe,
  onAddProfile,
  onTrust,
  onAuthenticate,
  onTerminalAuthenticate,
}: CodingAgentPickerProps) => {
  const [open, setOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const builtin = profiles.filter(profile => profile.isBuiltin);
  const external = profiles.filter(profile => !profile.isBuiltin);
  const select = (profile: CodingAgentProfile) => {
    if (profile.status === CodingAgentProfileStatus.Ready) {
      setOpen(false);
      onSelect(profile.id);
      return;
    }
    if (
      profile.status === CodingAgentProfileStatus.Detected ||
      profile.status === CodingAgentProfileStatus.Unavailable
    ) {
      onProbe(profile.id);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={i18nService.t('codingAgentNewTask')}
          >
            <Plus />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder={i18nService.t('codingAgentChooseAgent')} />
          <CommandList>
            <CommandEmpty>{i18nService.t('codingAgentNoAgents')}</CommandEmpty>
            <CommandGroup heading={i18nService.t('codingAgentBuiltIn')}>
              {builtin.map(profile => (
                <AgentItem key={profile.id} profile={profile} onSelect={select} />
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={i18nService.t('codingAgentExternal')}>
              {external.length > 0 ? (
                external.map(profile => (
                  <AgentItem key={profile.id} profile={profile} onSelect={select} />
                ))
              ) : (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  {i18nService.t('codingAgentNoExternal')}
                </p>
              )}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value={i18nService.t('codingAgentManageAgents')}
                onSelect={() => {
                  setOpen(false);
                  setManagerOpen(true);
                }}
              >
                <Settings2 />
                <span>{i18nService.t('codingAgentManageAgents')}</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
      <CodingAgentManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        profiles={external}
        onAddProfile={onAddProfile}
        onProbe={onProbe}
        onTrust={onTrust}
        onAuthenticate={onAuthenticate}
        onTerminalAuthenticate={onTerminalAuthenticate}
      />
    </Popover>
  );
};

const AgentItem = ({
  profile,
  onSelect,
}: {
  profile: CodingAgentProfile;
  onSelect: (profile: CodingAgentProfile) => void;
}) => (
  <CommandItem
    value={`${profile.name} ${profile.description}`}
    disabled={
      profile.status !== CodingAgentProfileStatus.Ready &&
      profile.status !== CodingAgentProfileStatus.Detected &&
      profile.status !== CodingAgentProfileStatus.Unavailable
    }
    onSelect={() => onSelect(profile)}
  >
    <Bot />
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{profile.name}</span>
      <span className="block truncate text-xs text-muted-foreground">{profile.description}</span>
    </span>
    <Badge variant="secondary">{i18nService.t(statusKey[profile.status])}</Badge>
  </CommandItem>
);

interface CodingAgentManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: CodingAgentProfile[];
  onAddProfile: (input: AddCodingAgentProfileInput) => Promise<boolean>;
  onProbe: (profileId: string) => void;
  onTrust: (profileId: string) => Promise<boolean>;
  onAuthenticate: (profileId: string, methodId: string) => Promise<boolean>;
  onTerminalAuthenticate: (profileId: string, methodId: string) => Promise<boolean>;
}

const CodingAgentManager = ({
  open,
  onOpenChange,
  profiles,
  onAddProfile,
  onProbe,
  onTrust,
  onAuthenticate,
  onTerminalAuthenticate,
}: CodingAgentManagerProps) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const [argumentsText, setArgumentsText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    const saved = await onAddProfile({
      name,
      description,
      command,
      args: argumentsText
        .split('\n')
        .map(argument => argument.trim())
        .filter(Boolean),
    });
    setSubmitting(false);
    if (!saved) return;
    setName('');
    setDescription('');
    setCommand('');
    setArgumentsText('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{i18nService.t('codingAgentManageAgents')}</DialogTitle>
          <DialogDescription>
            {i18nService.t('codingAgentManageAgentsDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {profiles.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              {i18nService.t('codingAgentNoExternal')}
            </p>
          ) : (
            profiles.map(profile => (
              <div key={profile.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{profile.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{profile.command}</p>
                  </div>
                  <Badge variant="secondary">{i18nService.t(statusKey[profile.status])}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {profile.status === CodingAgentProfileStatus.Untrusted && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void onTrust(profile.id)}
                    >
                      {i18nService.t('codingAgentTrustAgent')}
                    </Button>
                  )}
                  {profile.status === CodingAgentProfileStatus.NeedsAuth &&
                    profile.authMethods.map(method => (
                      <Button
                        key={method.id}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void (method.type === 'terminal'
                            ? onTerminalAuthenticate(profile.id, method.id)
                            : onAuthenticate(profile.id, method.id))
                        }
                      >
                        {i18nService.t('codingAgentAuthenticate')}: {method.name}
                      </Button>
                    ))}
                  {(profile.status === CodingAgentProfileStatus.Detected ||
                    profile.status === CodingAgentProfileStatus.Unavailable) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onProbe(profile.id)}
                    >
                      {i18nService.t('codingAgentProbeAgent')}
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <form onSubmit={event => void submit(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="coding-agent-name">
                {i18nService.t('codingAgentProfileName')}
              </FieldLabel>
              <Input
                id="coding-agent-name"
                value={name}
                onChange={event => setName(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="coding-agent-description">
                {i18nService.t('codingAgentProfileDescription')}
              </FieldLabel>
              <Input
                id="coding-agent-description"
                value={description}
                onChange={event => setDescription(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="coding-agent-command">
                {i18nService.t('codingAgentProfileCommand')}
              </FieldLabel>
              <Input
                id="coding-agent-command"
                value={command}
                onChange={event => setCommand(event.target.value)}
                required
              />
              <FieldDescription>{i18nService.t('codingAgentProfileCommandHint')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="coding-agent-arguments">
                {i18nService.t('codingAgentProfileArguments')}
              </FieldLabel>
              <Textarea
                id="coding-agent-arguments"
                className="min-h-20"
                value={argumentsText}
                onChange={event => setArgumentsText(event.target.value)}
              />
              <FieldDescription>
                {i18nService.t('codingAgentProfileArgumentsHint')}
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={submitting}>
              {i18nService.t('codingAgentAddProfile')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
