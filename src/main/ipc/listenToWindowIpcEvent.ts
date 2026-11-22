import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import type { z } from 'zod';

import type { IpcEventDefinition } from '../../shared/ipc/contract';

export function listenToWindowIpcEvent<Args extends z.ZodTuple>(
  definition: IpcEventDefinition<Args>,
  getWindow: () => BrowserWindow | null,
  handle: (window: BrowserWindow, ...args: z.output<Args>) => void,
): () => void {
  const listener = (event: IpcMainEvent, ...input: unknown[]): void => {
    const window = getWindow();
    if (!window || window.isDestroyed() || !event.senderFrame) return;
    const contents = window.webContents;
    if (
      contents.isDestroyed() ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame
    )
      return;
    const parsed = definition.args.safeParse(input);
    if (parsed.success) handle(window, ...parsed.data);
  };
  ipcMain.on(definition.channel, listener);
  return () => {
    ipcMain.removeListener(definition.channel, listener);
  };
}
