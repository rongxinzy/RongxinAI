import { ModelSelectorLogo } from '@shared/components/ai-elements/model-selector';
import React from 'react';

const GrokIcon: React.FC<{ className?: string }> = ({ className }) => (
  <ModelSelectorLogo provider="xai" className={className} />
);

export default GrokIcon;
