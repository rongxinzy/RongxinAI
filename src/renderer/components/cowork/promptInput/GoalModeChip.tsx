import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { Target, X } from 'lucide-react';
import React from 'react';

import { i18nService } from '../../../services/i18n';

const GoalModeChip: React.FC<{ onRemove: () => void; compact?: boolean }> = ({
  onRemove,
  compact = false,
}) => (
  <span
    className={cn(
      'inline-flex h-6 items-center gap-1.5 rounded-full px-1.5 text-xs font-medium text-(--zy-skill-blue-foreground) transition-colors hover:bg-(--zy-skill-blue-background)',
      compact && 'px-1',
    )}
    title={i18nService.t('goalMode')}
  >
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onRemove}
      aria-label={i18nService.t('clearGoalMode')}
      title={i18nService.t('clearGoalMode')}
      className="theme-page-cowork-prompt-input-button-1 group/goal relative ml-0.5"
    >
      <Target className="size-3.5 transition-opacity group-hover/goal:opacity-0" />
      <X className="absolute size-3.5 opacity-0 transition-opacity group-hover/goal:opacity-100" />
    </Button>
    {!compact && <span className="max-w-24 truncate">{i18nService.t('goalMode')}</span>}
  </span>
);

export default GoalModeChip;
