import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import { Badge } from '@shared/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Check, UsersRound } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';

interface SessionExpertPickerProps {
  selectedExpertIds: string[];
  onChange: (expertIds: string[]) => void;
  disabled?: boolean;
}

const SessionExpertPicker: React.FC<SessionExpertPickerProps> = ({
  selectedExpertIds,
  onChange,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentSession = useSelector((state: RootState) => state.cowork.currentSession);
  const experts = useMemo(
    () =>
      agents.filter(
        agent =>
          agent.enabled &&
          (agent.source === CoworkSessionExpertSource.Package ||
            agent.source === CoworkSessionExpertSource.Member),
      ),
    [agents],
  );
  const snapshotNames = useMemo(
    () =>
      new Map((currentSession?.experts ?? []).map(expert => [expert.expertId, expert.expertName])),
    [currentSession?.experts],
  );
  const selected = new Set(selectedExpertIds);

  if (experts.length === 0 && selectedExpertIds.length === 0) return null;

  const toggleExpert = (expertId: string) => {
    const next = selected.has(expertId)
      ? selectedExpertIds.filter(id => id !== expertId)
      : [expertId];
    onChange(next);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          nativeButton={true}
          render={
            <PromptInputButton
              type="button"
              disabled={disabled}
              tooltip={i18nService.t('addSessionExpert')}
            >
              <UsersRound data-icon="inline-start" />
              {selectedExpertIds.length > 0 && (
                <span className="text-xs">{selectedExpertIds.length}</span>
              )}
            </PromptInputButton>
          }
        />
        <PopoverContent
          side="top"
          align="start"
          sideOffset={4}
          className="w-80 rounded-md! bg-surface! p-0 shadow-md ring-0! outline-none!"
        >
          <Command className="rounded-md! bg-surface! **:data-[slot=input-group]:bg-transparent! **:data-[slot=input-group]:shadow-none!">
            <CommandInput
              placeholder={i18nService.t('searchSessionExperts')}
              className="bg-transparent"
            />
            <CommandList>
              <CommandEmpty>{i18nService.t('noSessionExperts')}</CommandEmpty>
              <CommandGroup heading={i18nService.t('sessionExperts')}>
                {experts.map(expert => {
                  const isSelected = selected.has(expert.id);
                  return (
                    <CommandItem
                      key={expert.id}
                      value={`${expert.name} ${expert.id}`}
                      onSelect={() => toggleExpert(expert.id)}
                      className="items-start gap-2 px-3 py-2"
                    >
                      <Check className={isSelected ? 'opacity-100' : 'opacity-0'} />
                      <span className="min-w-0 flex-1 truncate">{expert.name}</span>
                      {expert.presetId && (
                        <span className="max-w-24 truncate text-xs text-muted-foreground">
                          {expert.presetId}
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedExpertIds.map(expertId => {
        const expert = experts.find(item => item.id === expertId);
        const expertName = expert?.name ?? snapshotNames.get(expertId) ?? expertId;
        return (
          <Badge key={expertId} variant="secondary" title={expertName}>
            {expertName}
          </Badge>
        );
      })}
    </>
  );
};

export default SessionExpertPicker;
