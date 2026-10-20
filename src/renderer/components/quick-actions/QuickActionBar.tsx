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
    // One centered row when the stage is wide enough for every pill. Narrower
    // stages use a 3-column grid so six actions stay two even rows.
    <div className="mx-auto grid w-full grid-cols-3 justify-items-center gap-2 @min-[960px]:flex @min-[960px]:flex-nowrap @min-[960px]:items-center @min-[960px]:justify-center">
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
            {IconComponent && <IconComponent />}
            <span>{action.label}</span>
          </Button>
        );
      })}
    </div>
  );
};

export default QuickActionBar;
