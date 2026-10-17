/**
 * Inline "test connectivity" button used by IM settings panels.
 * Extracted from IMSettings.tsx's renderConnectivityTestButton (issue #1069).
 */
import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import { Signal } from 'lucide-react';
import React from 'react';

import { i18nService } from '../../../services/i18n';

interface ConnectivityTestButtonProps {
  testing: boolean;
  hasResult: boolean;
  disabled: boolean;
  onClick: () => void;
}

export const ConnectivityTestButton: React.FC<ConnectivityTestButtonProps> = ({
  testing,
  hasResult,
  disabled,
  onClick,
}) => (
  <Button type="button" variant="outline" size="sm" onClick={() => onClick()} disabled={disabled}>
    {testing ? <Spinner data-icon="inline-start" /> : <Signal data-icon="inline-start" />}
    {testing
      ? i18nService.t('imConnectivityTesting')
      : hasResult
        ? i18nService.t('imConnectivityRetest')
        : i18nService.t('imConnectivityTest')}
  </Button>
);
