import { useEffect } from 'react';

import { defaultConfig } from '../config';
import { configService } from '../services/config';
import { matchesShortcut } from '../services/shortcuts';

const isShortcutInputActive = () => {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  return activeElement.dataset.shortcutInput === 'true';
};

interface UseAppKeyboardShortcutsOptions {
  onNewChat: () => void;
  onShowSettings: () => void;
}

/**
 * Global keyboard shortcuts (new chat, search, settings). Inputs marked with
 * `data-shortcut-input` are excluded so typing stays unaffected.
 */
export function useAppKeyboardShortcuts({
  onNewChat,
  onShowSettings,
}: UseAppKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isShortcutInputActive()) return;

      const { shortcuts } = configService.getConfig();
      const activeShortcuts = {
        ...defaultConfig.shortcuts,
        ...(shortcuts ?? {}),
      };

      if (matchesShortcut(event, activeShortcuts.newChat)) {
        event.preventDefault();
        onNewChat();
        return;
      }

      if (matchesShortcut(event, activeShortcuts.search)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('cowork:shortcut:search'));
        return;
      }

      if (matchesShortcut(event, activeShortcuts.settings)) {
        event.preventDefault();
        onShowSettings();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onNewChat, onShowSettings]);
}
