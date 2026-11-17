import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { isAllowedLocalfilePath, resolveLocalfileRequestPath } from './localfilePathValidation';

describe('localfilePathValidation', () => {
  const allowedRoot = path.resolve('/tmp/test-user-data/cowork-images');

  test('allows files inside cowork-images root', () => {
    const insidePath = path.join(allowedRoot, 'session-123', 'hash456.png');
    expect(isAllowedLocalfilePath(insidePath, allowedRoot)).toBe(true);
  });

  test('allows safe external images', () => {
    const externalPng = path.resolve('/tmp/photos/avatar.png');
    expect(isAllowedLocalfilePath(externalPng, allowedRoot)).toBe(true);

    const externalJpg = path.resolve('/tmp/photos/banner.jpg');
    expect(isAllowedLocalfilePath(externalJpg, allowedRoot)).toBe(true);

    const externalSvg = path.resolve('/tmp/photos/icon.svg');
    expect(isAllowedLocalfilePath(externalSvg, allowedRoot)).toBe(true);
  });

  test('blocks non-image files', () => {
    expect(isAllowedLocalfilePath('/etc/passwd', allowedRoot)).toBe(false);
    expect(isAllowedLocalfilePath('/tmp/photos/script.sh', allowedRoot)).toBe(false);
    expect(isAllowedLocalfilePath('/tmp/photos/data.json', allowedRoot)).toBe(false);
    expect(isAllowedLocalfilePath('/tmp/photos/index.html', allowedRoot)).toBe(false);
  });

  test('blocks sensitive paths even with image extension', () => {
    expect(isAllowedLocalfilePath('/home/user/.ssh/id_rsa.png', allowedRoot)).toBe(false);
    expect(isAllowedLocalfilePath('/home/user/project/.env.png', allowedRoot)).toBe(false);
    expect(isAllowedLocalfilePath('/home/user/project/.git/config.png', allowedRoot)).toBe(false);
    expect(isAllowedLocalfilePath('/home/user/app/zhiyuan.sqlite', allowedRoot)).toBe(false);
    expect(
      isAllowedLocalfilePath('/home/user/node_modules/package/malicious.png', allowedRoot),
    ).toBe(false);
  });

  test('blocks path traversal attacks', () => {
    const traversalPath = path.join(allowedRoot, '..', '..', 'etc', 'passwd');
    expect(isAllowedLocalfilePath(traversalPath, allowedRoot)).toBe(false);
  });

  test('handles invalid inputs gracefully', () => {
    expect(isAllowedLocalfilePath('', allowedRoot)).toBe(false);
    expect(isAllowedLocalfilePath(null as unknown as string, allowedRoot)).toBe(false);
    expect(isAllowedLocalfilePath(undefined as unknown as string, allowedRoot)).toBe(false);
  });

  test('resolves localfile URLs across Windows drives, UNC shares, Chinese names, and special characters', () => {
    expect(
      resolveLocalfileRequestPath(
        'localfile:///work/%E5%9B%BE%20%231%3F100%25.png?revision=img-1-0',
        'darwin',
      ),
    ).toBe('/work/图 #1?100%.png');
    expect(
      resolveLocalfileRequestPath(
        'localfile:///C:/Users/%E5%BC%A0%E4%B8%89/chart%20%231%3F100%25.png?revision=1',
        'win32',
      ),
    ).toBe('C:\\Users\\张三\\chart #1?100%.png');
    expect(
      resolveLocalfileRequestPath('localfile://fileserver/share/plot%20%231.png', 'win32'),
    ).toBe('\\\\fileserver\\share\\plot #1.png');
  });
});
