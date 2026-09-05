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
      className="sidebar-interactive-surface ml-[-6px] flex h-7 w-[calc(100%+12px)] items-center justify-start rounded-md pl-[38px] pr-2.5 text-left text-sm font-normal text-foreground opacity-[0.28] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isLoading ? i18nService.t('loading') : label}
    </Button>
  );
};

export default ExpandAgentTasksRow;
