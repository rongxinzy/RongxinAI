import { describe, expect, test, vi } from 'vitest';

import { verifyPublishedBlockmap } from './published-update-smoke-lib.mjs';

describe('published update smoke helpers', () => {
  test('verifies the versioned redirect and Range support for differential blockmaps', async () => {
    const immutable =
      'https://downloads.rongxzyai.com/releases/2026.8.6/win32-x64-lite/ZhiYuan.exe.blockmap';
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { location: immutable } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { 'content-length': '321' } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          status: 206,
          headers: { 'content-range': 'bytes 0-0/321' },
        }),
      );

    await expect(
      verifyPublishedBlockmap({
        fetchImpl,
        target: 'win32:x64:lite',
        updaterUrl: new URL(
          'https://updates.rongxzyai.com/v2/electron/releases/2026.8.6/win32/x64/lite/ZhiYuan.exe',
        ),
        immutableUpdaterUrl: new URL(
          'https://downloads.rongxzyai.com/releases/2026.8.6/win32-x64-lite/ZhiYuan.exe',
        ),
        updaterFilename: 'ZhiYuan.exe',
      }),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]?.[0].toString()).toMatch(/ZhiYuan\.exe\.blockmap$/);
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      headers: { range: 'bytes=0-0' },
    });
  });

  test('skips formats whose blockmap is embedded or not supported', async () => {
    const fetchImpl = vi.fn();
    await expect(
      verifyPublishedBlockmap({
        fetchImpl,
        target: 'linux:x64:appimage',
        updaterUrl: new URL('https://updates.rongxzyai.com/ZhiYuan.AppImage'),
        immutableUpdaterUrl: new URL('https://downloads.rongxzyai.com/ZhiYuan.AppImage'),
        updaterFilename: 'ZhiYuan.AppImage',
      }),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
