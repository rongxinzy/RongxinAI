/**
 * Channel probe contract test — WeCom
 */
import { describe, test } from 'vitest';

import { runChannelProbeContract } from './channel-probe.contract';
import {
  buildProbeResult,
  makeAuthCheckFail,
  makeAuthCheckPass,
  makeGatewayRunningCheck,
  makeInboundActivityCheck,
} from './helpers';

describe('Channel probe contract: wecom', () => {
  test('missing_credentials path conforms to contract', () => {
    runChannelProbeContract({ platform: 'wecom', result: buildProbeResult('wecom') });
  });

  test('auth pass with active sessions conforms to contract', () => {
    runChannelProbeContract({
      platform: 'wecom',
      result: buildProbeResult('wecom', {
        checks: [
          makeAuthCheckPass('wwxxx'),
          makeGatewayRunningCheck(),
          makeInboundActivityCheck('pass'),
        ],
      }),
    });
  });

  test('auth fail conforms to contract', () => {
    runChannelProbeContract({
      platform: 'wecom',
      result: buildProbeResult('wecom', {
        checks: [makeAuthCheckFail('invalid botId'), makeGatewayRunningCheck()],
        verdict: 'fail',
      }),
    });
  });
});
