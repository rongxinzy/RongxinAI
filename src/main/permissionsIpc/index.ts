/** Calendar permission check/request IPC. */
import { appSystemContract } from '../../shared/ipc/appSystemContract';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';
import { isDev } from '../appBootstrap/appEnv';
import { checkCalendarPermission, requestCalendarPermission } from './calendarPermissions';

export const registerPermissionsIpc = (): void => {
  // ==================== Permissions IPC Handlers ====================
  handleIpcContractSubset(appSystemContract, {
    permissionsCheckCalendar: async () => {
      try {
        const status = await checkCalendarPermission();

        // Development mode: Auto-request permission if not determined
        // This provides a better dev experience without affecting production
        if (isDev && status === 'not-determined' && process.platform === 'darwin') {
          console.log('[Permissions] Development mode: Auto-requesting calendar permission...');
          try {
            await requestCalendarPermission();
            const newStatus = await checkCalendarPermission();
            console.log(
              '[Permissions] Development mode: Permission status after request:',
              newStatus,
            );
            return { success: true, status: newStatus, autoRequested: true };
          } catch (requestError) {
            console.warn('[Permissions] Development mode: Auto-request failed:', requestError);
          }
        }

        return { success: true, status };
      } catch (error) {
        console.error('[Main] Error checking calendar permission:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check permission',
        };
      }
    },
    permissionsRequestCalendar: async () => {
      try {
        // Request permission and check status
        const granted = await requestCalendarPermission();
        const status = await checkCalendarPermission();
        return { success: true, granted, status };
      } catch (error) {
        console.error('[Main] Error requesting calendar permission:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to request permission',
        };
      }
    },
  });
};
