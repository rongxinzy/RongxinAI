import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { expect, test } from 'vitest';

import { ACP_PROTOCOL_VERSION } from './protocol';

test('uses the stable protocol version from the official ACP SDK', () => {
  expect(ACP_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
});
