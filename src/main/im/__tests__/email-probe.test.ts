/**
 * Channel probe contract test — Email
 */
import { describe, test } from 'vitest';

import { runChannelProbeContract } from './channel-probe.contract';
import { buildProbeResult, makeAuthCheckPass, makeMissingCredentialsCheck, makeInboundActivityCheck } from './helpers';

describe('Channel probe contract: email', () => {
  test('missing_credentials path conforms to contract', () => {
    runChannelProbeContract({
      platform: 'email',
      result: buildProbeResult('email', {
        checks: [makeMissingCredentialsCheck('email address')],
        verdict: 'fail',
      }),
    });
  });

  test('auth pass with active sessions conforms to contract', () => {
    runChannelProbeContract({
      platform: 'email',
      result: buildProbeResult('email', {
        checks: [makeAuthCheckPass('user@example.com'), makeInboundActivityCheck('pass')],
      }),
    });
  });
});
