import { Button } from '@shared/components/ui/button';
import { Puzzle } from 'lucide-react';
import React, { useRef, useState } from 'react';

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
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleButtonClick = () => {
    setIsPopoverOpen(prev => !prev);
  };

  const handleClosePopover = () => {
    setIsPopoverOpen(false);
  };

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleButtonClick}
        className={`rounded-xl bg-surface text-secondary hover:text-primary dark:hover:text-primary hover:bg-surface-raised ${className}`}
        title="Skills"
      >
        <Puzzle className="h-5 w-5" />
      </Button>
      <SkillsPopover
        isOpen={isPopoverOpen}
        onClose={handleClosePopover}
        onSelectSkill={onSelectSkill}
        onManageSkills={onManageSkills}
        anchorRef={buttonRef}
      />
    </div>
  );
};

export default SkillsButton;
