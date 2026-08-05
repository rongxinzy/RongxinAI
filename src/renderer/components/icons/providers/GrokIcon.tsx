import { Sparkles } from 'lucide-react';
import React from 'react';

const GrokIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Sparkles className={className} aria-label="Grok" />
);

export default GrokIcon;
