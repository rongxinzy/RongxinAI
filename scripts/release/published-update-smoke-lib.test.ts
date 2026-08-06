import { describe, expect, test, vi } from 'vitest';

import {
  ONE_BYTE_RANGE_HEADERS,
  fetchOneByteRange,
  redirectMatches,
  verifyPublishedBlockmap,
} from './published-update-smoke-lib.mjs';

describe('published update smoke helpers', () => {
  test('disables cache for one-byte Range probes', () => {
    expect(ONE_BYTE_RANGE_HEADERS).toEqual({
      range: 'bytes=0-0',
      'cache-control': 'no-cache',
    });
  });

  test('retries a transient full-body response before requiring partial content', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          status: 206,
          headers: { 'content-range': 'bytes 0-0/2' },
        }),
      );

    const response = await fetchOneByteRange({
      fetchImpl,
      url: new URL('https://downloads.rongxzyai.com/file.exe'),
    });

    expect(response.status).toBe(206);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ headers: ONE_BYTE_RANGE_HEADERS });
  });

  test('compares redirects after URL normalization for Unicode filenames', () => {
    const signedUrl =
      'https://downloads.rongxzyai.com/releases/2026.8.6-build.6/win32-x64-lite/知远-Setup-2026.8.6-build.6.exe';
    const encodedLocation =
      'https://downloads.rongxzyai.com/releases/2026.8.6-build.6/win32-x64-lite/%E7%9F%A5%E8%BF%9C-Setup-2026.8.6-build.6.exe';

    expect(redirectMatches(encodedLocation, new URL('https://updates.rongxzyai.com/'), signedUrl)).toBe(
      true,
    );
  });

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
      headers: ONE_BYTE_RANGE_HEADERS,
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
