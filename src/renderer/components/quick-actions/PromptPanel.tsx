import React from 'react';

import type { LocalizedQuickAction } from '../../types/quickAction';
import CaseGallery from './CaseGallery';

interface PromptPanelProps {
  action: LocalizedQuickAction;
  onPromptSelect: (prompt: string) => void;
}

const PromptPanel: React.FC<PromptPanelProps> = ({ action, onPromptSelect }) => {
  if (!action.prompts || action.prompts.length === 0) {
    return null;
  }

  return (
    <div className="w-full animate-fade-in-up">
      <CaseGallery prompts={action.prompts} onPromptSelect={onPromptSelect} />
    </div>
  );
};

export default PromptPanel;
