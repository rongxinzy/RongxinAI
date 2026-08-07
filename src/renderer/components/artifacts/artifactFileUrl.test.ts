import { expect, test } from 'vitest';

import { toLocalFileUrl } from './artifactFileUrl';

test('converts Windows paths to browser-compatible file URLs', () => {
  expect(toLocalFileUrl('C:\\Users\\Administrator\\example.html')).toBe(
    'file:///C:/Users/Administrator/example.html',
  );
});

test('preserves valid file URLs and encodes local path characters', () => {
  expect(toLocalFileUrl('file:///C:/workspace/example.html')).toBe(
    'file:///C:/workspace/example.html',
  );
  expect(toLocalFileUrl('/tmp/example #1.html')).toBe('file:///tmp/example%20%231.html');
});
