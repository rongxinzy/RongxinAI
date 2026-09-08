import { ipcMain } from 'electron';
import type { BrowserWindow, ContextMenuParams } from 'electron';

import {
  ContextMenuAction,
  isContextMenuAction,
  type ContextMenuOpenEvent,
} from '../shared/contextMenu';
import { ContextMenuIpc } from '../shared/ipc/channels';

type ContextMenuSource = Pick<
  ContextMenuParams,
  'x' | 'y' | 'isEditable' | 'selectionText' | 'editFlags'
>;

export function createContextMenuOpenEvent(source: ContextMenuSource): ContextMenuOpenEvent {
  return {
    x: source.x,
    y: source.y,
    isEditable: source.isEditable,
    selectionText: source.selectionText,
    editFlags: {
      canUndo: source.editFlags.canUndo,
      canRedo: source.editFlags.canRedo,
      canCut: source.editFlags.canCut,
      canCopy: source.editFlags.canCopy,
      canPaste: source.editFlags.canPaste,
      canSelectAll: source.editFlags.canSelectAll,
    },
  };
}

const executeContextMenuAction = (window: BrowserWindow, action: ContextMenuAction): void => {
  const contents = window.webContents;
  if (contents.isDestroyed()) return;

  switch (action) {
    case ContextMenuAction.Undo:
      contents.undo();
      return;
    case ContextMenuAction.Redo:
      contents.redo();
      return;
    case ContextMenuAction.Cut:
      contents.cut();
      return;
    case ContextMenuAction.Copy:
      contents.copy();
      return;
    case ContextMenuAction.Paste:
      contents.paste();
      return;
    case ContextMenuAction.SelectAll:
      contents.selectAll();
  }
};

export function registerContextMenu(window: BrowserWindow): () => void {
  const listener = (_event: Electron.Event, params: ContextMenuParams) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(ContextMenuIpc.Open, createContextMenuOpenEvent(params));
  };
  const executeListener = (event: Electron.IpcMainEvent, action: unknown) => {
    if (event.sender !== window.webContents || !isContextMenuAction(action)) return;
    executeContextMenuAction(window, action);
  };

  window.webContents.on('context-menu', listener);
  ipcMain.on(ContextMenuIpc.Execute, executeListener);
  return () => {
    window.webContents.removeListener('context-menu', listener);
    ipcMain.removeListener(ContextMenuIpc.Execute, executeListener);
  };
}
