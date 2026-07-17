import { Button } from '@shared/components/ui/button';
import { Puzzle, X } from 'lucide-react';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { clearActiveSkills, toggleActiveSkill } from '../../store/slices/skillSlice';

const ActiveSkillBadge: React.FC = () => {
  const dispatch = useDispatch();
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const skills = useSelector((state: RootState) => state.skill.skills);

  const activeSkills = activeSkillIds
    .map(id => skills.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  if (activeSkills.length === 0) return null;

  const handleRemoveSkill = (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation();
    dispatch(toggleActiveSkill(skillId));
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(clearActiveSkills());
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {activeSkills.map(skill => (
        <div
          key={skill.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary-muted border border-primary"
        >
          <Puzzle className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-primary max-w-[80px] truncate">
            {skill.name}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={e => handleRemoveSkill(e, skill.id)}
            className="rounded hover:bg-primary-muted transition-colors"
            title={i18nService.t('clearSkill')}
          >
            <X className="h-2.5 w-2.5 text-primary" />
          </Button>
        </div>
      ))}
      {activeSkills.length > 1 && (
        <Button
          type="button"
          variant="link"
          onClick={handleClearAll}
          className="text-xs text-primary hover:text-primary-hover transition-colors px-0"
          title={i18nService.t('clearAllSkills')}
        >
          {i18nService.t('clearAll')}
        </Button>
      )}
    </div>
  );
};

export default ActiveSkillBadge;
