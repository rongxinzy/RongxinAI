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
    // The case panel is the same width as the composer above it (CoworkView max-w-3xl), so the
    // four-column grid lines up with the prompt input. The category bar keeps the wider column.
    <div className="mx-auto w-full max-w-3xl animate-fade-in-up">
      <CaseGallery
        prompts={action.prompts}
        capabilityLabel={action.label}
        onPromptSelect={onPromptSelect}
      />
    </div>
  );
};

export default PromptPanel;
