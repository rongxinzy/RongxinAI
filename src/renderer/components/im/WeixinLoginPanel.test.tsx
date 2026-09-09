// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { WeixinLoginErrorCode } from '@shared/ipc/channels';

import { i18nService } from '../../services/i18n';
import { WeixinLoginPanel } from './WeixinLoginPanel';

const QR_CODE = 'qr-code';
const QR_CODE_URL = 'https://example.com/qr-code';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('does not show the raw setup error', async () => {
  const rawError = 'Get "https://example.com?qrcode=private-value": EOF';
  window.electron = {
    im: {
      weixinLoginStart: vi.fn().mockResolvedValue({
        success: false,
        errorCode: WeixinLoginErrorCode.Transport,
        message: rawError,
      }),
    },
  } as unknown as typeof window.electron;

  render(<WeixinLoginPanel onConfirmed={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole('button'));

  expect(await screen.findByText(i18nService.t('imWeixinQrNetworkFailed'))).toBeInTheDocument();
  expect(screen.queryByText(rawError)).toBeNull();
});

test('retries two transient polling failures before showing a unified error', async () => {
  vi.useFakeTimers();
  const pollLogin = vi
    .fn()
    .mockResolvedValueOnce({ success: false, status: 'wait', errorCode: WeixinLoginErrorCode.Transport })
    .mockResolvedValueOnce({ success: false, status: 'wait', errorCode: WeixinLoginErrorCode.Transport })
    .mockResolvedValueOnce({ success: false, status: 'wait', errorCode: WeixinLoginErrorCode.Transport });
  window.electron = {
    im: {
      weixinLoginStart: vi.fn().mockResolvedValue({
        success: true,
        status: 'wait',
        qrcode: QR_CODE,
        qrcodeUrl: QR_CODE_URL,
      }),
      weixinLoginPoll: pollLogin,
    },
  } as unknown as typeof window.electron;

  render(<WeixinLoginPanel onConfirmed={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole('button'));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_000);
  });

  expect(pollLogin).toHaveBeenCalledTimes(3);
  expect(screen.getByText(i18nService.t('imWeixinQrNetworkFailed'))).toBeInTheDocument();
});
