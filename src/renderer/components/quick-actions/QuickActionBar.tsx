import { Button } from '@shared/components/ui/button';
import {
  ChartColumn,
  FileText,
  Globe,
  GraduationCap,
  Presentation,
  Smartphone,
  Telescope,
} from 'lucide-react';
import React from 'react';

import type { LocalizedQuickAction } from '../../types/quickAction';

interface QuickActionBarProps {
  actions: LocalizedQuickAction[];
  onActionSelect: (actionId: string) => void;
}

// 图标映射
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Presentation,
  Globe,
  Smartphone,
  ChartColumn,
  GraduationCap,
  Telescope,
  FileText,
};

const QuickActionBar: React.FC<QuickActionBarProps> = ({ actions, onActionSelect }) => {
  if (actions.length === 0) {
    return null;
  }

  return (
    // One centered row on wide screens; below the composer width the actions
    // become a balanced grid so a wrapped tail never leaves a lonely pill.
    <div className="mx-auto -mt-3 grid w-full max-w-4xl grid-cols-2 gap-2 md:grid-cols-3 xl:flex xl:flex-wrap xl:items-center xl:justify-center">
      {actions.map(action => {
        const IconComponent = iconMap[action.icon];

        return (
          <Button
            key={action.id}
            type="button"
            variant="outline"
            onClick={() => onActionSelect(action.id)}
            className="theme-page-quick-action-bar-button-1 flex items-center justify-center whitespace-nowrap"
          >
            {IconComponent && <IconComponent className="size-4" />}
            <span>{action.label}</span>
          </Button>
        );
      })}
    </div>
  );
};

export default QuickActionBar;
