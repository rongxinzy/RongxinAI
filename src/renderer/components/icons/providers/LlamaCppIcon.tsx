import React from 'react';

import llamaCppIconUrl from '../../../assets/provider-icons/llamacpp.png';

const LlamaCppIcon: React.FC<{ className?: string }> = ({ className }) => (
  <img
    src={llamaCppIconUrl}
    alt="llama.cpp"
    className={className}
    style={{ width: 24, height: 24, objectFit: 'contain', flex: '0 0 auto', lineHeight: 1 }}
  />
);

export default LlamaCppIcon;
