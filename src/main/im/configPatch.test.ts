import { expect, test } from 'vitest';

import { sanitizeRendererIMConfigPatch } from './configPatch';

test('stale renderer snapshots cannot undo a completed Weixin QR login', () => {
  const confirmedLogin = {
    enabled: true,
    accountId: 'wx-account',
    token: 'wx-token',
    baseUrl: 'https://ilinkai.weixin.qq.com',
    dmPolicy: 'open' as const,
    allowFrom: [],
  };
  const stalePatch = sanitizeRendererIMConfigPatch({
    weixin: {
      enabled: false,
      accountId: '',
      token: '',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      dmPolicy: 'allowlist',
      allowFrom: ['wx-user'],
    },
  });

  expect({ ...confirmedLogin, ...stalePatch.weixin }).toEqual({
    ...confirmedLogin,
    dmPolicy: 'allowlist',
    allowFrom: ['wx-user'],
  });
});

test('allows an explicit minimal Weixin enabled-state patch', () => {
  expect(sanitizeRendererIMConfigPatch({ weixin: { enabled: false } })).toEqual({
    weixin: { enabled: false },
  });
});
