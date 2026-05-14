/**
 * Channel probe contract test — Discord
 */
import { describe, test } from 'vitest';

import { runChannelProbeContract } from './channel-probe.contract';
import { buildProbeResult, makeAuthCheckFail, makeAuthCheckPass, makeGatewayRunningCheck, makeInboundActivityCheck } from './helpers';

describe('Channel probe contract: discord', () => {
  test('missing_credentials path conforms to contract', () => {
    runChannelProbeContract({ platform: 'discord', result: buildProbeResult('discord') });
  });

  test('auth pass with active sessions conforms to contract', () => {
    runChannelProbeContract({
      platform: 'discord',
      result: buildProbeResult('discord', {
        checks: [makeAuthCheckPass('MyBot#1234'), makeGatewayRunningCheck(), makeInboundActivityCheck('pass')],
      }),
    });
  });

  test('auth fail conforms to contract', () => {
    runChannelProbeContract({
      platform: 'discord',
      result: buildProbeResult('discord', {
        checks: [makeAuthCheckFail('401 Unauthorized'), makeGatewayRunningCheck()],
        verdict: 'fail',
      }),
    });
  });
});
