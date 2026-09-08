// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ContextMenuAction, type ContextMenuOpenEvent } from '@shared/contextMenu';

import { ContextMenu } from './ContextMenu';

let openContextMenu: ((event: ContextMenuOpenEvent) => void) | null = null;
const execute = vi.fn();

const installContextMenuBridge = () => {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      contextMenu: {
        execute,
        onOpen: (callback: (event: ContextMenuOpenEvent) => void) => {
          openContextMenu = callback;
          return () => {
            openContextMenu = null;
          };
        },
      },
    },
  });
};

afterEach(() => {
  execute.mockReset();
  openContextMenu = null;
});

test('renders icon menu items at a received context menu position', () => {
  installContextMenuBridge();
  const { container } = render(<ContextMenu />);

  act(() => {
    openContextMenu?.({
      x: 120,
      y: 80,
      isEditable: true,
      selectionText: 'selected text',
      editFlags: {
        canUndo: true,
        canRedo: false,
        canCut: true,
        canCopy: true,
        canPaste: true,
        canSelectAll: true,
      },
    });
  });

  expect(container.ownerDocument.querySelectorAll('svg')).toHaveLength(5);

  fireEvent.click(screen.getByRole('menuitem', { name: '复制' }));

  expect(execute).toHaveBeenCalledWith(ContextMenuAction.Copy);
});
