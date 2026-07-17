import { Button } from '@shared/components/ui/button';
import { Check,Copy } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../../services/i18n';

export const CopyButton: React.FC<{
  content: string;
  visible: boolean;
}> = ({ content, visible }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleCopy}
      className={visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}
      tabIndex={visible ? 0 : -1}
      title={i18nService.t('copyToClipboard')}
      aria-label={i18nService.t('copyToClipboard')}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
};

/** Re-edit button — lets the user re-fill a sent message back into the input. */
export const ReEditButton: React.FC<{
  visible: boolean;
  onClick: () => void;
}> = ({ visible, onClick }) => (
  <Button
    variant="ghost"
    size="icon-sm"
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}
    tabIndex={visible ? 0 : -1}
    title={i18nService.t('coworkReEdit')}
    aria-label={i18nService.t('coworkReEdit')}
  >
    <PencilEditIcon />
  </Button>
);

const PencilEditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className="text-(--icon-secondary)" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
