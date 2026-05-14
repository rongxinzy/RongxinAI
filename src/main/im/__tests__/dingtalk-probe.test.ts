/**
 * Channel probe contract test — DingTalk
 */
import { describe, test } from 'vitest';

import { runChannelProbeContract } from './channel-probe.contract';
import { buildProbeResult, makeAuthCheckFail, makeAuthCheckPass, makeGatewayRunningCheck, makeInboundActivityCheck } from './helpers';

describe('Channel probe contract: dingtalk', () => {
  test('missing_credentials path conforms to contract', () => {
    runChannelProbeContract({ platform: 'dingtalk', result: buildProbeResult('dingtalk') });
  });

  test('auth pass with active sessions conforms to contract', () => {
    runChannelProbeContract({
      platform: 'dingtalk',
      result: buildProbeResult('dingtalk', {
        checks: [makeAuthCheckPass('dingxxx'), makeGatewayRunningCheck(), makeInboundActivityCheck('pass')],
      }),
    });
  });

  test('auth fail conforms to contract', () => {
    runChannelProbeContract({
      platform: 'dingtalk',
      result: buildProbeResult('dingtalk', {
        checks: [makeAuthCheckFail('invalid clientId'), makeGatewayRunningCheck()],
        verdict: 'fail',
      }),
    });
  });
});
