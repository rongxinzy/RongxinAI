import { expect, test } from 'vitest';

import { listScheduledTaskChannels } from './helpers';

test('preserves complete channel account IDs for delivery routing', () => {
  const accountId = 'eb74163d-9aaa-4186-a526-36f249ca883b';
  const channels = listScheduledTaskChannels({
    dingtalk: {
      instances: [{ enabled: true, instanceId: accountId, instanceName: 'Operations' }],
    },
  });

  expect(channels).toContainEqual(
    expect.objectContaining({ accountId, filterAccountId: accountId, label: 'Operations' }),
  );
});

test('includes the singleton WeChat account ID for scheduled delivery routing', () => {
  const accountId = '793dea927a8a@im.bot';
  const channels = listScheduledTaskChannels({
    weixin: { enabled: true, accountId },
  });

  expect(channels).toContainEqual(
    expect.objectContaining({ value: 'weixin', accountId, filterAccountId: accountId }),
  );
});
