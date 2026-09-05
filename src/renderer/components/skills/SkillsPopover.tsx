import { Button } from '@shared/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Separator } from '@shared/components/ui/separator';
import { Check, Cog } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { PlusMenuSkillsIcon } from '../cowork/plusMenuIcons';
import { skillService } from '../../services/skill';
import { RootState } from '../../store';
import { Skill } from '../../types/skill';

interface SkillsPopoverProps {
  /** Trigger element (typically a Button) */
  children: React.ReactNode;
  /** Called when a skill is selected (multi-select — popover stays open) */
  onSelectSkill: (skill: Skill) => void;
  /** Called when "Manage Skills" is clicked */
  onManageSkills: () => void;
}

const SkillsPopover: React.FC<SkillsPopoverProps> = ({
  children,
  onSelectSkill,
  onManageSkills,
}) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const skills = useSelector((state: RootState) => state.skill.skills);
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);

  const enabledSkills = useMemo(
    () =>
      skills
        .filter(skill => skill.enabled)
        .map(skill => ({
          skill,
          localizedDescription: skillService.getLocalizedSkillDescription(
            skill.id,
            skill.name,
            skill.description,
          ),
        })),
    [skills],
  );
  const matchingSkills = useMemo(() => {
    const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedSearchQuery) return enabledSkills;

    return enabledSkills.filter(({ skill, localizedDescription }) =>
      [skill.id, skill.name, localizedDescription]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedSearchQuery),
    );
  }, [enabledSkills, searchQuery]);

  const handleSelectSkill = useCallback(
    (skillId: string) => {
      const skill = skills.find(s => s.id === skillId);
      if (skill) {
        onSelectSkill(skill);
      }
    },
    [skills, onSelectSkill],
  );

  const handleManageSkills = useCallback(() => {
    onManageSkills();
    setOpen(false);
  }, [onManageSkills]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery('');
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger nativeButton={true} render={children as React.ReactElement} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={4}
        className="theme-page-skills-popover-popover-content-1"
      >
        <Command shouldFilter={false} className="theme-part-skills-popover-command-1">
          <CommandInput
            placeholder={i18nService.t('searchSkills')}
            className="theme-control-transparent"
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList className="max-h-64">
            {matchingSkills.length === 0 ? (
              <CommandEmpty>
                {i18nService.t(searchQuery.trim() ? 'noMatchingSkills' : 'noSkillsAvailable')}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {matchingSkills.map(({ skill, localizedDescription }) => {
                  const isActive = activeSkillIds.includes(skill.id);
                  return (
                    <CommandItem
                      key={skill.id}
                      value={`${skill.name} ${localizedDescription}`}
                      onSelect={() => handleSelectSkill(skill.id)}
                      data-checked={isActive || undefined}
                      className="theme-control-sizing-1 flex items-start gap-3"
                    >
                      <div
                        className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          isActive ? 'bg-primary text-white' : 'bg-muted'
                        }`}
                      >
                        {isActive ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <PlusMenuSkillsIcon className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-medium truncate ${
                              isActive ? 'text-primary' : 'text-foreground'
                            }`}
                          >
                            {skill.name}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {localizedDescription}
                        </p>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
          <Separator />
          <div className="p-1">
            <Button
              variant="ghost"
              onClick={handleManageSkills}
              className="theme-page-skills-popover-button-1 w-full flex items-center justify-between"
            >
              <span>{i18nService.t('manageSkills')}</span>
              <Cog className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default SkillsPopover;
