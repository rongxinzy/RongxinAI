import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { X } from 'lucide-react';
import React from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { ExpertAvatar } from '../expert/expertAvatars';

interface ActiveExpertBadgeProps {
  expertId?: string;
  expertName?: string;
  onRemove: () => void;
  compact?: boolean;
  className?: string;
}

const ActiveExpertBadge: React.FC<ActiveExpertBadgeProps> = ({
  expertId,
  expertName,
  onRemove,
  compact = false,
  className,
}) => {
  const expert = useSelector((state: RootState) =>
    state.agent.agents.find(agent => agent.id === expertId),
  );

  if (!expertId) return null;
  const displayName = expert?.name ?? expertName ?? expertId;
  const avatarName = expert?.presetId || expert?.id || expertId;

  return (
    <span
      className={cn(
        'theme-prompt-expert-chip sidebar-interactive-surface inline-flex max-w-48 items-center gap-1.5',
        className,
      )}
      title={displayName}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={i18nService.t('clearExpert')}
        title={i18nService.t('clearExpert')}
        onClick={onRemove}
        className="theme-page-active-expert-badge-button-1 group/expert relative"
      >
        <ExpertAvatar
          name={avatarName}
          label={displayName}
          className="size-4 rounded-full border-0 transition-opacity group-hover/expert:opacity-0"
        />
        <X className="absolute size-4 text-primary opacity-0 transition-opacity group-hover/expert:opacity-100" />
      </Button>
      {!compact && <span className="truncate">{displayName}</span>}
    </span>
  );
};

export default ActiveExpertBadge;
