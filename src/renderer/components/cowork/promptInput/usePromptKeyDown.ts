import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { useCoworkSlashMenu } from '../useCoworkSlashMenu';
import { matchesSendShortcut, useSendShortcut } from './sendShortcut';

interface UsePromptKeyDownParams {
  value: string;
  disabled: boolean;
  isStreaming: boolean;
  isPatchingModel: boolean;
  canQueueWhileStreaming: boolean;
  slashMenu: ReturnType<typeof useCoworkSlashMenu>;
  handleSubmit: () => void | Promise<void>;
}

/**
 * Keyboard interaction for the Cowork composer: while the slash menu is open
 * it owns the navigation keys, and Enter submits according to the configured
 * send shortcut (falling back to inserting a plain newline text node).
 */
export function usePromptKeyDown({
  value,
  disabled,
  isStreaming,
  isPatchingModel,
  canQueueWhileStreaming,
  slashMenu,
  handleSubmit,
}: UsePromptKeyDownParams) {
  const currentSendShortcut = useSendShortcut();

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const isComposing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (isComposing) return;

    // While the slash menu is open it owns navigation keys; Enter either
    // inserts the highlighted entry or, when the text already is that
    // entry, dismisses the menu and falls through to the send logic.
    if (slashMenu.open) {
      if (event.key === 'Escape') {
        event.preventDefault();
        slashMenu.dismiss();
        return;
      }
      if (slashMenu.items.length > 0) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const selectedIndex = slashMenu.items.findIndex(
            item => item.key === slashMenu.activeItemKey,
          );
          const offset = event.key === 'ArrowDown' ? 1 : -1;
          const nextIndex =
            (Math.max(selectedIndex, 0) + offset + slashMenu.items.length) % slashMenu.items.length;
          slashMenu.setMenuSelection(slashMenu.items[nextIndex].key);
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          slashMenu.selectMenuChoice(slashMenu.activeItemKey);
          return;
        }
        if (event.key === 'Enter') {
          const matchesSelection =
            slashMenu.activeSelectionPrompt !== null && value === slashMenu.activeSelectionPrompt;
          const fallsThrough = slashMenu.choiceMenuOpen
            ? matchesSelection
            : matchesSelection && !slashMenu.selectedCommand?.hint;
          if (!fallsThrough) {
            event.preventDefault();
            slashMenu.selectMenuChoice(slashMenu.activeItemKey);
            return;
          }
          slashMenu.dismiss();
        }
      }
    }

    if (event.key !== 'Enter') return;

    const isSendCombo = matchesSendShortcut(
      {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      },
      currentSendShortcut,
    );

    if (isSendCombo && (!isStreaming || canQueueWhileStreaming) && !disabled && !isPatchingModel) {
      event.preventDefault();
      handleSubmit();
    } else {
      // Keep newlines as text nodes. Letting contenteditable create block
      // elements makes the serialized prompt browser-dependent.
      event.preventDefault();
      document.execCommand('insertText', false, '\n');
    }
  };

  return handleKeyDown;
}
