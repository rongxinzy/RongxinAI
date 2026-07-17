import { Box } from 'lucide-react';
import React from 'react';

import { i18nService } from '../../services/i18n';
import type { Model } from '../../store/slices/modelSlice';
import ModelSelector from '../ModelSelector';
import AgentWorkingDirectoryField from './AgentWorkingDirectoryField';

interface AgentDetailToolbarProps {
  model: Model | null;
  onModelChange: (model: Model | null) => void;
  workingDirectory: string;
  onWorkingDirectoryChange: (value: string) => void;
}

const AgentDetailToolbar: React.FC<AgentDetailToolbarProps> = ({
  model,
  onModelChange,
  workingDirectory,
  onWorkingDirectoryChange,
}) => (
  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
    <div
      className="flex h-8 min-w-0 items-center gap-1 rounded-lg bg-surface-raised/70 pl-2 text-foreground"
      title={i18nService.t('agentDefaultModel')}
    >
      <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
      <ModelSelector
        dropdownDirection="up"
        value={model}
        onChange={onModelChange}
        defaultLabel={i18nService.t('agentUseDefaultModel')}
        portal
      />
    </div>
    <AgentWorkingDirectoryField
      value={workingDirectory}
      onChange={onWorkingDirectoryChange}
      compact
    />
  </div>
);

export default AgentDetailToolbar;
