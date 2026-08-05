import React from 'react';

const GrokIcon: React.FC<{ className?: string }> = ({ className }) => (
  <img
    src="https://models.dev/logos/xai.svg"
    alt="Grok / xAI"
    className={className}
    width={24}
    height={24}
  />
);

export default GrokIcon;
