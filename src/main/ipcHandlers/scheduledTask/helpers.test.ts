import { expect, test } from 'vitest';

import { initScheduledTaskHelpers, listScheduledTaskChannels } from './helpers';

test('preserves complete channel account IDs for delivery routing', () => {
  const accountId = 'eb74163d-9aaa-4186-a526-36f249ca883b';
  initScheduledTaskHelpers({
    getIMGatewayManager: () => ({
      getConfig: () => ({
        dingtalk: {
          instances: [{ enabled: true, instanceId: accountId, instanceName: 'Operations' }],
        },
      }),
    }),
  });

  expect(listScheduledTaskChannels()).toContainEqual(
    expect.objectContaining({ accountId, filterAccountId: accountId, label: 'Operations' }),
  );
});
