import { ipcMain } from 'electron';

import { ActivityIpc } from '../../shared/activity/constants';
import type { ActivityService } from './activityService';

export const registerActivityIpcHandlers = (getService: () => ActivityService): void => {
  ipcMain.handle(ActivityIpc.List, () => ({ success: true, runs: getService().list() }));
};
