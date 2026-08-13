import { expect, test } from 'vitest';

import { channelOptionValue, findChannelOption } from './channelOptionValue';

test('keeps channel accounts distinct in select values', () => {
  const first = { value: 'dingtalk-connector', label: 'First', accountId: 'account-one' };
  const second = { value: 'dingtalk-connector', label: 'Second', accountId: 'account-two' };

  expect(channelOptionValue(first)).not.toBe(channelOptionValue(second));
  expect(findChannelOption([first, second], channelOptionValue(second))).toBe(second);
});
