import { Button } from '@shared/components/ui/button';
import React from 'react';

import { i18nService } from '../../services/i18n';

interface ExpandAgentTasksRowProps {
  isLoading: boolean;
  label: string;
  onClick: () => void;
}

const ExpandAgentTasksRow: React.FC<ExpandAgentTasksRowProps> = ({ isLoading, label, onClick }) => {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={isLoading}
      className="theme-page-expand-agent-tasks-row-button-1 sidebar-interactive-surface ml-[-6px] flex items-center justify-start text-left disabled:cursor-not-allowed"
    >
      {isLoading ? i18nService.t('loading') : label}
    </Button>
  );
};

export default ExpandAgentTasksRow;
