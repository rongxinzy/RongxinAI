import { expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

import { getCronJobService, initCronJobServiceManager } from './cronJobServiceManager';

test('forwards gateway lifecycle events to the cron job service', () => {
  let disconnectCallback: ((reason: string) => void) | null = null;
  let reconnectCallback: (() => void) | null = null;

  initCronJobServiceManager({
    getOpenClawChannelGateway: () => ({
      getGatewayClient: () => null,
      ensureReady: async () => {},
      onGatewayDisconnect: callback => {
        disconnectCallback = callback;
        return () => {};
      },
      onGatewayReconnect: callback => {
        reconnectCallback = callback;
        return () => {};
      },
    }),
  });

  const service = getCronJobService();
  const handleDisconnected = vi.spyOn(service, 'handleGatewayDisconnected');
  const handleConnected = vi.spyOn(service, 'handleGatewayConnected');

  (disconnectCallback as ((reason: string) => void) | null)?.('connection closed');
  (reconnectCallback as (() => void) | null)?.();

  expect(handleDisconnected).toHaveBeenCalledOnce();
  expect(handleConnected).toHaveBeenCalledOnce();
});
