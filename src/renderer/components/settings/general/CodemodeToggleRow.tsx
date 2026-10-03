import { SettingsToggleRow } from '../../common/SettingsToggleRow';
import { useEffect, useState } from 'react';

import { i18nService } from '../../../services/i18n';

/**
 * Cowork-wide switch for the pi 1.0 codemode sandbox tool. Sessions pick the
 * flag up when they start; a live session rebuilds on the next turn.
 */
export function CodemodeToggleRow() {
  const [codemodeEnabled, setCodemodeEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electron.cowork
      .getConfig()
      .then(result => {
        if (!cancelled && result?.success && result.config) {
          setCodemodeEnabled(result.config.codemodeEnabled === true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsToggleRow
      label={i18nService.t('codemodeEnabled')}
      description={i18nService.t('codemodeEnabledDescription')}
      checked={codemodeEnabled}
      onCheckedChange={async (next: boolean) => {
        setCodemodeEnabled(next);
        try {
          await window.electron.cowork.setConfig({ codemodeEnabled: next });
        } catch (err) {
          console.error('Failed to set codemode config:', err);
          setCodemodeEnabled(!next);
        }
      }}
    />
  );
}
