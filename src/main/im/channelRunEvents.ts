import { BrowserWindow } from 'electron';

import type { ChannelRunSummary } from '../../shared/channelRun/constants';
import { ChannelRunIpc } from '../../shared/channelRun/constants';

/**
 * Broadcasts a Channel/Cron run lifecycle event to every renderer window.
 * The projection is read-only: renderers never drive channel runs (issue
 * #225 — channel events stay off cowork:stream:*).
 */
export const emitChannelRunEvent = (summary: ChannelRunSummary): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(ChannelRunIpc.RunEvent, summary);
    }
  }
};
