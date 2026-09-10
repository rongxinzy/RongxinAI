import { createRequire } from 'node:module';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { assertOfficialQqBotPlatform } = require('./channel-runtime-smoke.cjs') as {
  assertOfficialQqBotPlatform: (health: { platforms: unknown[] }) => void;
};

test('accepts a runtime that includes the official QQ Bot adapter', () => {
  expect(() =>
    assertOfficialQqBotPlatform({
      platforms: [{ accountId: '__zhiyuan_qqbot__', platform: 'qqbot', state: 'starting' }],
    }),
  ).not.toThrow();
});

test('rejects a runtime built without the official QQ Bot adapter', () => {
  expect(() =>
    assertOfficialQqBotPlatform({
      platforms: [
        {
          accountId: '__zhiyuan_qqbot__',
          platform: 'qqbot',
          state: 'unavailable',
          lastError: 'unknown platform "qqbot"',
        },
      ],
    }),
  ).toThrow('built without the official QQ Bot platform');
});
