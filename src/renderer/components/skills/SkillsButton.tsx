import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import { cn } from '@shared/lib/utils';
import React from 'react';

import { Skill } from '../../types/skill';
import { PlusMenuSkillsIcon } from '../cowork/plusMenuIcons';
import SkillsPopover from './SkillsPopover';

interface SkillsButtonProps {
  onSelectSkill: (skill: Skill) => void;
  onManageSkills: () => void;
  className?: string;
}

const SkillsButton: React.FC<SkillsButtonProps> = ({
  onSelectSkill,
  onManageSkills,
  className = '',
}) => {
  return (
    <SkillsPopover onSelectSkill={onSelectSkill} onManageSkills={onManageSkills}>
      <PromptInputButton
        className={cn(
          'theme-prompt-skills-action',
          className,
        )}
        title="Skills"
      >
        <PlusMenuSkillsIcon className="h-4 w-4" />
      </PromptInputButton>
    </SkillsPopover>
  );
};

export default SkillsButton;
