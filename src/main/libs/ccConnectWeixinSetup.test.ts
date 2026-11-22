import { expect, test } from 'vitest';

import {
  formatWeixinSetupErrorForLog,
  isWeixinSetupTransportError,
  runCcConnectWeixinSetup,
} from './ccConnectWeixinSetup';

test('does not start a setup process after channel shutdown', async () => {
  const error = new Error('Channel runtime stopped');
  await expect(
    runCcConnectWeixinSetup('unused', 'start', undefined, AbortSignal.abort(error)),
  ).rejects.toBe(error);
});

test('recognizes EOF as a temporary Weixin setup transport error', () => {
  expect(isWeixinSetupTransportError(new Error('Get "https://example.com": EOF'))).toBe(true);
});

test('does not classify setup failures as transport errors', () => {
  expect(isWeixinSetupTransportError(new Error('Weixin setup returned invalid JSON'))).toBe(false);
});

test('redacts the QR code from Weixin setup errors before logging', () => {
  const error = new Error('Get "https://example.com/poll?qrcode=secret-qr-code&foo=bar": EOF');

  expect(formatWeixinSetupErrorForLog(error)).toBe(
    'Get "https://example.com/poll?qrcode=[redacted]&foo=bar": EOF',
  );
});
