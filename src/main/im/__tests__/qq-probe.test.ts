/**
 * Channel probe contract test — QQ
 */
import { describe, test } from 'vitest';

import { runChannelProbeContract } from './channel-probe.contract';
import {
  buildProbeResult,
  makeAuthCheckFail,
  makeAuthCheckPass,
  makeCheck,
  makeGatewayRunningCheck,
  makeInboundActivityCheck,
} from './helpers';

describe('Channel probe contract: qq', () => {
  test('missing_credentials path conforms to contract', () => {
    runChannelProbeContract({ platform: 'qq', result: buildProbeResult('qq') });
  });

  test('auth pass with active sessions conforms to contract', () => {
    runChannelProbeContract({
      platform: 'qq',
      result: buildProbeResult('qq', {
        checks: [
          makeAuthCheckPass('1020xxxx'),
          makeGatewayRunningCheck(),
          makeInboundActivityCheck('pass'),
        ],
      }),
    });
  });

  test('auth fail conforms to contract', () => {
    runChannelProbeContract({
      platform: 'qq',
      result: buildProbeResult('qq', {
        checks: [makeAuthCheckFail('invalid appId'), makeGatewayRunningCheck()],
        verdict: 'fail',
      }),
    });
  });

  test('qq mention hint conforms to contract', () => {
    runChannelProbeContract({
      platform: 'qq',
      result: buildProbeResult('qq', {
        checks: [
          makeAuthCheckPass('1020xxxx'),
          makeCheck('qq_mention_hint', 'info', 'QQ requires @mentions in groups.'),
          makeGatewayRunningCheck(),
        ],
      }),
    });
  });
});
