import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

function moveComposer(host: HTMLElement, target: HTMLElement) {
  if (host.parentElement === target) return;
  const focused = host.contains(document.activeElement)
    ? (document.activeElement as HTMLElement)
    : null;
  const selection = focused ? window.getSelection() : null;
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  // Chromium's state-preserving move retains ProseMirror selection, IME and focus.
  // Older browser previews use a synchronous focus/selection restore.
  if (host.isConnected && target.isConnected && typeof target.moveBefore === 'function') {
    target.moveBefore(host, null);
  } else {
    target.appendChild(host);
    if (focused) {
      focused.focus({ preventScroll: true });
      if (range && selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }
}

/** A stable portal owns the editor; home/session slots only move its host element. */
export function usePersistentComposer() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.className = 'w-full min-w-0';
    return element;
  });
  const slotRef = useCallback(
    (target: HTMLDivElement | null) => {
      // Park inside the stable stage before React removes the previous slot.
      const destination = target ?? rootRef.current;
      if (destination) moveComposer(host, destination);
    },
    [host],
  );
  const renderComposer = (children: ReactNode) => createPortal(children, host);
  return { rootRef, slotRef, renderComposer };
}
