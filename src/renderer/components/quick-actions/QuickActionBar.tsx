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
    <div className="flex items-center justify-center gap-2 overflow-x-auto px-1 pb-1 sm:overflow-visible sm:px-0 sm:pb-0 sm:[&>*]:shrink-0">
      {actions.map(action => {
        const IconComponent = iconMap[action.icon];

        return (
          <Button
            key={action.id}
            type="button"
            variant="outline"
            onClick={() => onActionSelect(action.id)}
            className="theme-page-quick-action-bar-button-1 flex items-center whitespace-nowrap"
          >
            {IconComponent && <IconComponent className="w-4 h-4 text-muted-foreground" />}
            <span>{action.label}</span>
          </Button>
        );
      })}
    </div>
  );
};

export default QuickActionBar;
