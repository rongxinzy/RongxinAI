import { Button } from '@shared/components/ui/button';
import { Puzzle } from 'lucide-react';
import React from 'react';

import { Skill } from '../../types/skill';
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
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={`rounded-xl bg-surface text-muted-foreground hover:text-primary dark:hover:text-primary hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${className}`}
        title="Skills"
      >
        <Puzzle className="h-5 w-5" />
      </Button>
    </SkillsPopover>
  );
};

export default SkillsButton;
