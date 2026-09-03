import { Button } from '@shared/components/ui/button';
import { ChartColumn, FileText, Globe, GraduationCap, Presentation, Smartphone, Telescope } from 'lucide-react';
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
    <div className="flex flex-wrap items-center justify-center gap-2.5">
      {actions.map(action => {
        const IconComponent = iconMap[action.icon];

        return (
          <Button
            key={action.id}
            type="button"
            variant="outline"
            onClick={() => onActionSelect(action.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ease-out bg-surface border-border text-muted-foreground hover:bg-surface-raised hover:border-primary/40"
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
