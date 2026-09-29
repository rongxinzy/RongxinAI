import type { BrowserWindow } from 'electron';

export const safeWindowSend = (
  window: BrowserWindow,
  channel: string,
  payload: unknown,
): boolean => {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
  try {
    window.webContents.send(channel, payload);
    return true;
  } catch (error) {
    console.debug('[WindowMessaging] skipped a send to a destroyed window:', error);
    return false;
  }
};
