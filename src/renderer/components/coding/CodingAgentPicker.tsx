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
import { Bot, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';

import {
  CodingAgentProfileStatus,
  type AddCodingAgentProfileInput,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingAgentManager } from './CodingAgentManager';
import { CodingAgentStatusI18nKey } from './constants';

interface CodingAgentPickerProps {
  profiles: CodingAgentProfile[];
  onSelect: (profileId: string) => void;
  onDiscover: () => Promise<boolean>;
  onProbe: (profileId: string) => Promise<boolean>;
  onAddProfile: (input: AddCodingAgentProfileInput) => Promise<boolean>;
  onTrust: (profileId: string) => Promise<boolean>;
  onAuthenticate: (profileId: string, methodId: string) => Promise<boolean>;
  onTerminalAuthenticate: (profileId: string, methodId: string) => Promise<boolean>;
}

export const CodingAgentPicker = ({
  profiles,
  onSelect,
  onDiscover,
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
  const select = async (profile: CodingAgentProfile) => {
    if (profile.status === CodingAgentProfileStatus.Ready) {
      setOpen(false);
      onSelect(profile.id);
      return;
    }
    if (
      profile.status === CodingAgentProfileStatus.Detected ||
      profile.status === CodingAgentProfileStatus.Unavailable
    ) {
      const connected = await onProbe(profile.id);
      if (!connected) return;
      setOpen(false);
      onSelect(profile.id);
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
      <PopoverContent align="start" className="theme-control-sizing-4 w-80">
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
        onDiscover={onDiscover}
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
  onSelect: (profile: CodingAgentProfile) => Promise<void>;
}) => (
  <CommandItem
    value={`${profile.name} ${profile.description}`}
    disabled={
      profile.status !== CodingAgentProfileStatus.Ready &&
      !(
        profile.command &&
        (profile.status === CodingAgentProfileStatus.Detected ||
          profile.status === CodingAgentProfileStatus.Unavailable)
      )
    }
    onSelect={() => void onSelect(profile)}
  >
    <Bot />
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{profile.name}</span>
      <span className="block truncate text-xs text-muted-foreground">{profile.description}</span>
    </span>
    <Badge variant="secondary">{i18nService.t(CodingAgentStatusI18nKey[profile.status])}</Badge>
  </CommandItem>
);
