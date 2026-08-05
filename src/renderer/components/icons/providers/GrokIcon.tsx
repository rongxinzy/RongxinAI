import { X } from 'lucide-react';
import React from 'react';

const GrokIcon: React.FC<{ className?: string }> = ({ className }) => (
  <X className={className} aria-label="Grok / xAI" />
);

export default GrokIcon;
