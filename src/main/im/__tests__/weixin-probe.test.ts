/**
 * Channel probe contract test — Weixin (WeChat)
 */
import { describe, test } from 'vitest';

import { runChannelProbeContract } from './channel-probe.contract';
import { buildProbeResult, makeCheck, makeGatewayRunningCheck } from './helpers';

describe('Channel probe contract: weixin', () => {
  test('missing_credentials path conforms to contract', () => {
    runChannelProbeContract({ platform: 'weixin', result: buildProbeResult('weixin') });
  });

  test('weixin not logged in conforms to contract', () => {
    runChannelProbeContract({
      platform: 'weixin',
      result: buildProbeResult('weixin', {
        checks: [
          makeCheck(
            'weixin_not_logged_in',
            'warn',
            'WeChat is not logged in.',
            'Scan the QR code in the WeChat tab to log in.',
          ),
          makeGatewayRunningCheck(),
        ],
        verdict: 'warn',
      }),
    });
  });

  test('weixin account missing conforms to contract', () => {
    runChannelProbeContract({
      platform: 'weixin',
      result: buildProbeResult('weixin', {
        checks: [
          makeCheck('weixin_account_missing', 'fail', 'No WeChat account configured.'),
          makeGatewayRunningCheck(),
        ],
        verdict: 'fail',
      }),
    });
  });

  test('weixin gateway probe failed conforms to contract', () => {
    runChannelProbeContract({
      platform: 'weixin',
      result: buildProbeResult('weixin', {
        checks: [
          makeCheck(
            'weixin_gateway_probe_failed',
            'warn',
            'WeChat gateway probe failed.',
            'Check that the OpenClaw Gateway is running.',
          ),
          makeCheck('openclaw_gateway_not_running', 'fail', 'OpenClaw Gateway is not running.'),
        ],
        verdict: 'fail',
      }),
    });
  });
});
