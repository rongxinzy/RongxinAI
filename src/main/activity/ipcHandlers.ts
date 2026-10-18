import type { ActivityService } from './activityService';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { activityContract } from '../../shared/ipc/automationContract';

export const registerActivityIpcHandlers = (getService: () => ActivityService): void => {
  handleIpcContract(activityContract, {
    list: () => ({ success: true, runs: getService().list() }),
  });
};
