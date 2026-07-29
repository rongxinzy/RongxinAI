import { Button } from '@shared/components/ui/button';
import { X } from 'lucide-react';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { resolveSkillIconUrl } from '../../services/skillIcon';
import { RootState } from '../../store';
import { clearSelection } from '../../store/slices/quickActionSlice';
import { clearActiveSkills, toggleActiveSkill } from '../../store/slices/skillSlice';
import type { Skill } from '../../types/skill';
import { PlusMenuSkillsIcon } from '../cowork/plusMenuIcons';
import { findChatSkillShortcut } from '../chat/constants';

interface SkillChipProps {
  skillId: string;
  skill?: Skill;
  onRemove: (e: React.MouseEvent) => void;
}

/**
 * Removable chip for one active skill. Core skills (the Chat quick-skill
 * entries) show their semantic label (PPT / 深度研究 / …) and icon; other
 * skills fall back to displayName/name with their own icon or a puzzle
 * glyph.
 */
const SkillChip: React.FC<SkillChipProps> = ({ skillId, skill, onRemove }) => {
  const shortcut = findChatSkillShortcut(skillId);
  const label = shortcut
    ? i18nService.t(shortcut.labelKey)
    : skill?.displayName || skill?.name || skillId;
  const ShortcutIcon = shortcut?.icon;

  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full pl-1.5 pr-1 text-xs font-medium text-(--zy-skill-blue-foreground) transition-colors hover:bg-(--zy-skill-blue-background)">
      {skill?.iconUrl ? (
        <img
          src={resolveSkillIconUrl(skill.iconUrl)}
          alt=""
          className="size-3.5 object-contain"
        />
      ) : ShortcutIcon ? (
        <ShortcutIcon className="size-3.5" />
      ) : (
        <PlusMenuSkillsIcon className="size-3.5" />
      )}
      <span className="max-w-24 truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        title={i18nService.t('clearSkill')}
        className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-(--zy-skill-blue-foreground)/10"
      >
        <X className="size-3" />
      </button>
    </span>
  );
};

const ActiveSkillBadge: React.FC = () => {
  const dispatch = useDispatch();
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const selectedActionId = useSelector((state: RootState) => state.quickAction.selectedActionId);
  const selectedQuickAction = useSelector((state: RootState) =>
    state.quickAction.actions.find(action => action.id === selectedActionId),
  );

  const activeSkills = activeSkillIds
    .map(id => skills.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  const quickActionSkillId = selectedQuickAction?.skillMapping;
  const showQuickActionFallback = activeSkills.length === 0 && !!quickActionSkillId;

  if (activeSkills.length === 0 && !showQuickActionFallback) return null;

  const handleRemoveSkill = (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation();
    dispatch(toggleActiveSkill(skillId));
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(clearActiveSkills());
  };

  const handleRemoveQuickAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(clearSelection());
    dispatch(clearActiveSkills());
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {showQuickActionFallback && quickActionSkillId && (
        <SkillChip
          skillId={quickActionSkillId}
          skill={skills.find(s => s.id === quickActionSkillId)}
          onRemove={handleRemoveQuickAction}
        />
      )}
      {activeSkills.map(skill => (
        <SkillChip
          key={skill.id}
          skillId={skill.id}
          skill={skill}
          onRemove={e => handleRemoveSkill(e, skill.id)}
        />
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
