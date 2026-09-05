import { Button } from '@shared/components/ui/button';
import { Plus } from 'lucide-react';
import React from 'react';

import { i18nService } from '../../services/i18n';

interface MyAgentSidebarHeaderProps {
  onCreateAgent: () => void;
}

const MyAgentSidebarHeader: React.FC<MyAgentSidebarHeaderProps> = ({ onCreateAgent }) => {
  return (
    <div className="sticky top-0 z-30 flex h-10 items-center justify-between bg-surface-raised px-1.5">
      <h2 className="min-w-0 truncate text-sm font-normal text-foreground opacity-[0.28]">
        {i18nService.t('myAgents')}
      </h2>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onCreateAgent}
        className="text-foreground opacity-[0.34] hover:opacity-[0.5]"
        aria-label={i18nService.t('createNewAgent')}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default MyAgentSidebarHeader;
