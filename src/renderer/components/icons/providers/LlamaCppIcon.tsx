import React from 'react';

import { cn } from '@shared/lib/utils';

import llamaCppIconUrl from '../../../assets/provider-icons/llamacpp.png';

const LlamaCppIcon: React.FC<{ className?: string }> = ({ className }) => (
  <img
    src={llamaCppIconUrl}
    alt="llama.cpp"
    className={cn('size-6 shrink-0 object-contain leading-none', className)}
  />
);

export default LlamaCppIcon;
