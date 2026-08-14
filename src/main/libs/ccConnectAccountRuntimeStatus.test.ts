import { expect, test } from 'vitest';

import { resolveCcConnectAccountRuntimeStatus } from './ccConnectAccountRuntimeStatus';
import { CcConnectRuntimeStatusRegistry } from './ccConnectRuntimeStatusRegistry';

test('does not leak a failed Feishu account error into Weixin status', () => {
  const statuses = new CcConnectRuntimeStatusRegistry();
  statuses.replace([
    {
      accountId: 'feishu-account',
      platform: 'feishu',
      state: 'unavailable',
      lastError: 'feishu: invalid domain',
    },
    {
      accountId: 'weixin-account',
      platform: 'weixin',
      state: 'ready',
    },
  ]);

  expect(resolveCcConnectAccountRuntimeStatus(statuses, 'feishu-account', true)).toMatchObject({
    connected: false,
    lastError: 'feishu: invalid domain',
  });
  expect(resolveCcConnectAccountRuntimeStatus(statuses, 'weixin-account', true)).toMatchObject({
    connected: true,
    lastError: null,
  });
  expect(
    resolveCcConnectAccountRuntimeStatus(statuses, 'missing-weixin-account', true),
  ).toMatchObject({
    connected: false,
    lastError: null,
  });
});

test('never reports an account as connected after the sidecar stops', () => {
  const statuses = new CcConnectRuntimeStatusRegistry();
  statuses.replace([{ accountId: 'account', platform: 'weixin', state: 'ready' }]);

  expect(resolveCcConnectAccountRuntimeStatus(statuses, 'account', false).connected).toBe(false);
});
