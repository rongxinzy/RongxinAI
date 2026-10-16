/**
 * Reusable guide card component for platform setup instructions.
 * Extracted verbatim from IMSettings.tsx (issue #1069).
 */
import { Button } from '@shared/components/ui/button';
import React from 'react';

import { i18nService } from '../../../services/i18n';

export const PlatformGuide: React.FC<{
  title?: string;
  steps: string[];
  guideUrl?: string;
  guideLabel?: string;
}> = ({ title, steps, guideUrl, guideLabel }) => (
  <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
    {title && <p className="text-xs text-foreground leading-relaxed mb-1.5 font-medium">{title}</p>}
    <ol className="text-xs text-muted-foreground flex flex-col gap-1 list-decimal list-inside">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
    {guideUrl && (
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => {
          window.electron.shell.openExternal(guideUrl).catch((err: unknown) => {
            console.error('[IM] Failed to open guide URL:', err);
          });
        }}
        className="theme-action-inline-underlined mt-2"
      >
        {guideLabel || i18nService.t('imViewGuide')}
      </Button>
    )}
  </div>
);
