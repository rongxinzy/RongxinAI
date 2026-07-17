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
import { Check, Cog, Puzzle } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
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
  const skills = useSelector((state: RootState) => state.skill.skills);
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);

  // Filter enabled skills
  const filteredSkills = skills.filter(s => s.enabled);

  const handleSelectSkill = useCallback((skillId: string) => {
    const skill = skills.find(s => s.id === skillId);
    if (skill) {
      onSelectSkill(skill);
    }
  }, [skills, onSelectSkill]);

  const handleManageSkills = useCallback(() => {
    onManageSkills();
    setOpen(false);
  }, [onManageSkills]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={children as React.ReactElement} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={4}
        className="w-72 rounded-md! border-0! bg-surface! p-0 shadow-md ring-0! outline-none!"
      >
        <Command
          shouldFilter={false}
          className="rounded-md! bg-surface! **:data-[slot=input-group]:border-0! **:data-[slot=input-group]:bg-transparent! **:data-[slot=input-group]:shadow-none! **:data-[slot=input-group]:ring-0!"
        >
          <CommandInput
            placeholder={i18nService.t('searchSkills')}
            className="bg-transparent focus:ring-0"
          />
          <CommandList className="max-h-64">
            <CommandEmpty>
              {i18nService.t('noSkillsAvailable')}
            </CommandEmpty>
            <CommandGroup>
              {filteredSkills.map((skill) => {
                const isActive = activeSkillIds.includes(skill.id);
                return (
                  <CommandItem
                    key={skill.id}
                    value={skill.id}
                    onSelect={() => handleSelectSkill(skill.id)}
                    data-checked={isActive || undefined}
                    className="flex items-start gap-3 px-3 py-2.5"
                  >
                    <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isActive
                        ? 'bg-primary text-white'
                        : 'bg-muted'
                    }`}>
                      {isActive ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Puzzle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium truncate ${
                          isActive
                            ? 'text-primary'
                            : 'text-foreground'
                        }`}>
                          {skill.name}
                        </span>
                        {skill.isOfficial && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary/10 text-primary shrink-0">
                            {i18nService.t('official')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description)}
                      </p>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          <Separator />
          <Button
            variant="ghost"
            onClick={handleManageSkills}
            className="w-full flex items-center justify-between px-4 py-3 h-auto text-sm text-foreground hover:bg-muted transition-colors rounded-none rounded-b-xl"
          >
            <span>{i18nService.t('manageSkills')}</span>
            <Cog className="h-4 w-4 text-muted-foreground" />
          </Button>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default SkillsPopover;
