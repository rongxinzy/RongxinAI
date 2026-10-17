import { useEffect, useState } from 'react';

import { configService } from '../../../services/config';

const isMacPlatform = navigator.platform.includes('Mac');

export interface SendShortcutModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Whether a keydown matches the configured send shortcut. Unknown config
 * values fall back to bare Enter so the user can always send.
 */
export function matchesSendShortcut(
  modifiers: SendShortcutModifiers,
  sendKey: string,
  isMac: boolean = isMacPlatform,
): boolean {
  switch (sendKey) {
    case 'Enter':
      return !modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.altKey;
    case 'Shift+Enter':
      return modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.altKey;
    case 'Ctrl+Enter':
      return isMac
        ? modifiers.metaKey && !modifiers.ctrlKey && !modifiers.shiftKey && !modifiers.altKey
        : modifiers.ctrlKey && !modifiers.metaKey && !modifiers.shiftKey && !modifiers.altKey;
    case 'Alt+Enter':
      return modifiers.altKey && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.shiftKey;
    default:
      // Unknown config value — fall back to bare Enter so the user can always send
      return !modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.altKey;
  }
}

/**
 * Track the configured send shortcut. Uses synced state (kept up-to-date via
 * the config-updated event) so that changes made in the Settings panel are
 * reflected immediately without requiring a configService read at event time.
 */
export function useSendShortcut(): string {
  const [currentSendShortcut, setCurrentSendShortcut] = useState(
    () => configService.getConfig().shortcuts?.sendMessage ?? 'Enter',
  );

  // Sync when config is updated elsewhere (e.g. Settings panel)
  useEffect(() => {
    const syncFromConfig = () => {
      const latest = configService.getConfig().shortcuts?.sendMessage ?? 'Enter';
      setCurrentSendShortcut(latest);
    };
    window.addEventListener('config-updated', syncFromConfig);
    return () => window.removeEventListener('config-updated', syncFromConfig);
  }, []);

  return currentSendShortcut;
}
