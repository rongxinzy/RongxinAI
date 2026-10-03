import { SettingsToggleRow } from '../../common/SettingsToggleRow';
import { useEffect, useState } from 'react';

import { i18nService } from '../../../services/i18n';

/**
 * Cowork-wide switch for pi 1.0's builtin MCP extension. When on, work
 * sessions connect configured MCP servers through pi itself (per-server
 * exposure decides how the model reaches the tools); when off, the legacy
 * single-gateway tool keeps serving them. Live sessions rebuild on the next
 * turn after the flag flips.
 */
export function McpNativeBridgeToggleRow() {
  const [mcpNativeBridge, setMcpNativeBridge] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electron.cowork
      .getConfig()
      .then(result => {
        if (!cancelled && result?.success && result.config) {
          setMcpNativeBridge(result.config.mcpNativeBridge === true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsToggleRow
      label={i18nService.t('mcpNativeBridge')}
      description={i18nService.t('mcpNativeBridgeDescription')}
      checked={mcpNativeBridge}
      onCheckedChange={async (next: boolean) => {
        setMcpNativeBridge(next);
        try {
          await window.electron.cowork.setConfig({ mcpNativeBridge: next });
        } catch (err) {
          console.error('Failed to set MCP native bridge config:', err);
          setMcpNativeBridge(!next);
        }
      }}
    />
  );
}
