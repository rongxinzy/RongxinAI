import { beforeEach, describe, expect, test, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  ipcMain: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

vi.mock('electron', () => ({ ipcMain: electronMocks.ipcMain }));

import { ContextMenuAction, isContextMenuAction } from '../shared/contextMenu';
import { createContextMenuOpenEvent, registerContextMenu } from './contextMenu';

beforeEach(() => {
  electronMocks.ipcMain.on.mockReset();
  electronMocks.ipcMain.removeListener.mockReset();
});

function createWindow(): {
  window: Electron.BrowserWindow;
  webContents: { on: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
  setDestroyed: (destroyed: boolean) => void;
} {
  let destroyed = false;
  const webContents = {
    isDestroyed: vi.fn(() => destroyed),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const window = {
    isDestroyed: vi.fn(() => destroyed),
    get webContents() {
      if (destroyed) throw new TypeError('Object has been destroyed');
      return webContents;
    },
  } as unknown as Electron.BrowserWindow;

  return {
    window,
    webContents,
    setDestroyed: value => {
      destroyed = value;
    },
  };
}

describe('context menu IPC payload', () => {
  test('forwards only the renderer state required to render menu actions', () => {
    expect(
      createContextMenuOpenEvent({
        x: 24,
        y: 48,
        isEditable: true,
        selectionText: 'selected text',
        editFlags: {
          canUndo: true,
          canRedo: false,
          canCut: true,
          canCopy: true,
          canPaste: true,
          canDelete: true,
          canSelectAll: true,
          canEditRichly: false,
        },
      }),
    ).toEqual({
      x: 24,
      y: 48,
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

  test('accepts only declared context menu actions', () => {
    expect(isContextMenuAction(ContextMenuAction.Copy)).toBe(true);
    expect(isContextMenuAction('delete')).toBe(false);
  });

  test('removes IPC listeners without touching destroyed webContents', () => {
    const { window, webContents, setDestroyed } = createWindow();
    const unregister = registerContextMenu(window);

    setDestroyed(true);
    expect(() => unregister()).not.toThrow();
    expect(webContents.removeListener).not.toHaveBeenCalled();
    expect(electronMocks.ipcMain.removeListener).toHaveBeenCalledOnce();
  });

  test('makes cleanup idempotent while keeping the IPC listener removal', () => {
    const { window, webContents } = createWindow();
    const unregister = registerContextMenu(window);

    unregister();
    unregister();

    expect(webContents.removeListener).toHaveBeenCalledOnce();
    expect(electronMocks.ipcMain.removeListener).toHaveBeenCalledOnce();
  });
});
