import { Button } from '@shared/components/ui/button';
import { Check, Copy, Pencil } from 'lucide-react';
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
      className={
        visible
          ? 'theme-page-copy-button-button-variant-1'
          : 'theme-page-copy-button-button-variant-2 pointer-events-none'
      }
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
    onClick={e => {
      e.stopPropagation();
      onClick();
    }}
    className={
      visible
        ? 'theme-page-copy-button-button-variant-3'
        : 'theme-page-copy-button-button-variant-4 pointer-events-none'
    }
    tabIndex={visible ? 0 : -1}
    title={i18nService.t('coworkReEdit')}
    aria-label={i18nService.t('coworkReEdit')}
  >
    <Pencil className="h-3.5 w-3.5" />
  </Button>
);
