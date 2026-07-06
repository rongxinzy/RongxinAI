import { Button } from '@shared/components/ui/button';
import React from 'react';

import { i18nService } from '../../services/i18n';

interface ExpandAgentTasksRowProps {
  isLoading: boolean;
  label: string;
  onClick: () => void;
}

const ExpandAgentTasksRow: React.FC<ExpandAgentTasksRowProps> = ({
  isLoading,
  label,
  onClick,
}) => {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={isLoading}
      className="-ml-[6px] flex h-7 w-[calc(100%+12px)] items-center justify-start rounded-md pl-[38px] pr-2.5 text-left text-[13px] font-normal text-foreground opacity-[0.28] hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/[0.04]"
    >
      {isLoading ? i18nService.t('loading') : label}
    </Button>
  );
};

export default ExpandAgentTasksRow;
