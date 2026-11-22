import type { BrowserWindow, ContextMenuParams } from 'electron';

import { ContextMenuAction, type ContextMenuOpenEvent } from '../shared/contextMenu';
import { appEventContract } from '../shared/ipc/appEventContract';
import { ContextMenuIpc } from '../shared/ipc/channels';
import { listenToWindowIpcEvent } from './ipc/listenToWindowIpcEvent';

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
  let isUnregistered = false;
  const listener = (_event: Electron.Event, params: ContextMenuParams) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(ContextMenuIpc.Open, createContextMenuOpenEvent(params));
  };
  window.webContents.on('context-menu', listener);
  const stopExecution = listenToWindowIpcEvent(
    appEventContract.contextMenuExecute,
    () => window,
    executeContextMenuAction,
  );
  return () => {
    if (isUnregistered) return;
    isUnregistered = true;
    if (!window.isDestroyed()) {
      const contents = window.webContents;
      if (!contents.isDestroyed()) contents.removeListener('context-menu', listener);
    }
    stopExecution();
  };
}
