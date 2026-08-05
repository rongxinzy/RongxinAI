import { ModelSelectorLogo } from '@shared/components/ai-elements/model-selector';
import React from 'react';

const GrokIcon: React.FC<{ className?: string }> = ({ className }) => (
  <ModelSelectorLogo
    provider="xai"
    className={className ?? 'size-6 object-contain'}
  />
);

export default GrokIcon;
