import { beforeEach, describe, expect, test, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  ipcMain: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

vi.mock('electron', () => ({ ipcMain: electronMocks.ipcMain }));

import { ContextMenuAction } from '../shared/contextMenu';
import { ContextMenuIpc } from '../shared/ipc/channels';
import { createContextMenuOpenEvent, registerContextMenu } from './contextMenu';

beforeEach(() => {
  electronMocks.ipcMain.on.mockReset();
  electronMocks.ipcMain.removeListener.mockReset();
});

function createWindow(): {
  window: Electron.BrowserWindow;
  webContents: {
    mainFrame: object;
    on: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    copy: ReturnType<typeof vi.fn>;
  };
  setDestroyed: (destroyed: boolean) => void;
} {
  let destroyed = false;
  const webContents = {
    isDestroyed: vi.fn(() => destroyed),
    mainFrame: {},
    on: vi.fn(),
    removeListener: vi.fn(),
    copy: vi.fn(),
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

  test('runs only declared context menu actions from the owning main frame', () => {
    const { window, webContents, setDestroyed } = createWindow();
    registerContextMenu(window);
    const [channel, execute] = electronMocks.ipcMain.on.mock.calls[0];
    expect(channel).toBe(ContextMenuIpc.Execute);
    const sender = { sender: webContents, senderFrame: webContents.mainFrame };

    execute(sender, 'delete');
    execute(sender, ContextMenuAction.Copy, 'extra argument');
    execute({ ...sender, senderFrame: {} }, ContextMenuAction.Copy);
    execute({ ...sender, sender: {} }, ContextMenuAction.Copy);
    expect(webContents.copy).not.toHaveBeenCalled();

    execute(sender, ContextMenuAction.Copy);
    expect(webContents.copy).toHaveBeenCalledOnce();
    setDestroyed(true);
    expect(() => execute(sender, ContextMenuAction.Copy)).not.toThrow();
    expect(webContents.copy).toHaveBeenCalledOnce();
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
    const [channel, listener] = electronMocks.ipcMain.on.mock.calls[0];
    expect(electronMocks.ipcMain.removeListener).toHaveBeenCalledExactlyOnceWith(channel, listener);
  });
});
