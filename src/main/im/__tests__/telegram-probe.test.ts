/**
 * Channel probe contract test — Telegram
 */
import { describe, test } from 'vitest';

import { runChannelProbeContract } from './channel-probe.contract';
import { buildProbeResult, makeAuthCheckFail, makeAuthCheckPass, makeGatewayRunningCheck, makeInboundActivityCheck } from './helpers';

describe('Channel probe contract: telegram', () => {
  test('missing_credentials path conforms to contract', () => {
    runChannelProbeContract({
      platform: 'telegram',
      result: buildProbeResult('telegram'),
    });
  });

  test('auth pass with active sessions conforms to contract', () => {
    runChannelProbeContract({
      platform: 'telegram',
      result: buildProbeResult('telegram', {
        checks: [
          makeAuthCheckPass('test_telegram_bot'),
          makeGatewayRunningCheck(),
          makeInboundActivityCheck('pass'),
        ],
      }),
    });
  });

  test('auth fail with missing credentials conforms to contract', () => {
    runChannelProbeContract({
      platform: 'telegram',
      result: buildProbeResult('telegram', {
        checks: [
          makeAuthCheckFail('Unauthorized'),
          makeGatewayRunningCheck(),
        ],
        verdict: 'fail',
      }),
    });
  });

  test('inbound_activity warn conforms to contract', () => {
    runChannelProbeContract({
      platform: 'telegram',
      result: buildProbeResult('telegram', {
        checks: [
          makeAuthCheckPass('bot'),
          makeGatewayRunningCheck(),
          makeInboundActivityCheck('warn'),
        ],
        verdict: 'warn',
      }),
    });
  });
});
