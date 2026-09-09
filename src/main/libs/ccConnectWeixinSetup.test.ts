import { expect, test } from 'vitest';

import {
  formatWeixinSetupErrorForLog,
  isWeixinSetupTransportError,
} from './ccConnectWeixinSetup';

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
