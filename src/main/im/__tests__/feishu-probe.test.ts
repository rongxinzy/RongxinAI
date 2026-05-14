/**
 * Channel probe contract test — Feishu
 */
import { describe, test } from 'vitest';

import { runChannelProbeContract } from './channel-probe.contract';
import { buildProbeResult, makeAuthCheckFail, makeAuthCheckPass, makeCheck, makeGatewayRunningCheck, makeInboundActivityCheck } from './helpers';

describe('Channel probe contract: feishu', () => {
  test('missing_credentials path conforms to contract', () => {
    runChannelProbeContract({ platform: 'feishu', result: buildProbeResult('feishu') });
  });

  test('auth pass with active sessions conforms to contract', () => {
    runChannelProbeContract({
      platform: 'feishu',
      result: buildProbeResult('feishu', {
        checks: [makeAuthCheckPass('cli_xxx'), makeGatewayRunningCheck(), makeInboundActivityCheck('pass')],
      }),
    });
  });

  test('auth fail conforms to contract', () => {
    runChannelProbeContract({
      platform: 'feishu',
      result: buildProbeResult('feishu', {
        checks: [makeAuthCheckFail('invalid app_id'), makeGatewayRunningCheck()],
        verdict: 'fail',
      }),
    });
  });

  test('event_subscription warn check conforms to contract', () => {
    runChannelProbeContract({
      platform: 'feishu',
      result: buildProbeResult('feishu', {
        checks: [
          makeAuthCheckPass('cli_xxx'),
          makeCheck('feishu_event_subscription_required', 'warn', 'Event subscription is recommended.', 'Subscribe to message events in the Feishu console.'),
          makeGatewayRunningCheck(),
        ],
        verdict: 'warn',
      }),
    });
  });
});
