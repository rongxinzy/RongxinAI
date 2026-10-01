import { expect, test } from 'vitest';

import { fileUrlToNativePath, normalizeArtifactPath, resolveArtifactPath } from './artifactPath';

test('decodes file URLs into the native path the main process can stat', () => {
  expect(resolveArtifactPath('file:///D:/report%20with%20spaces.pptx')).toBe(
    'D:/report with spaces.pptx',
  );
  expect(resolveArtifactPath('file:///D:/%E6%8A%A5%E5%91%8A%20%E7%A9%BA%E6%A0%BC.pptx')).toBe(
    'D:/报告 空格.pptx',
  );
  expect(resolveArtifactPath('file:///D:/50%25.pptx')).toBe('D:/50%.pptx');
  expect(resolveArtifactPath('file:///D:/a%23b.pptx')).toBe('D:/a#b.pptx');
  expect(resolveArtifactPath('file:///D:/a%3Fb.pptx')).toBe('D:/a?b.pptx');
  // Unencoded spaces and fragments are URL syntax, not part of the path.
  expect(resolveArtifactPath('file:///D:/a b.pptx#page=2')).toBe('D:/a b.pptx');
});

test('accepts file URLs with a bare scheme, a UNC host and localhost', () => {
  expect(resolveArtifactPath('file:/D:/x.pptx')).toBe('D:/x.pptx');
  expect(resolveArtifactPath('file:D:/x.pptx')).toBe('D:/x.pptx');
  expect(resolveArtifactPath('file://server/share/x.pptx')).toBe('//server/share/x.pptx');
  expect(resolveArtifactPath('file://localhost/D:/x.pptx')).toBe('D:/x.pptx');
  expect(resolveArtifactPath('file:///home/user/report%20x.pptx')).toBe('/home/user/report x.pptx');
});

test('keeps native paths verbatim so literal separators survive', () => {
  expect(resolveArtifactPath('C:\\workspace\\50%25.pptx')).toBe('C:/workspace/50%25.pptx');
  expect(resolveArtifactPath('/home/user/a#b.pptx')).toBe('/home/user/a#b.pptx');
  expect(resolveArtifactPath('/D:/report.pptx')).toBe('D:/report.pptx');
  expect(normalizeArtifactPath('C:\\workspace\\a.pptx')).toBe('C:/workspace/a.pptx');
});

test('joins relative workspace paths against cwd and leaves other schemes alone', () => {
  expect(resolveArtifactPath('output/report.pptx', 'C:/workspace')).toBe(
    'C:/workspace/output/report.pptx',
  );
  expect(resolveArtifactPath('artifacts\\out.pptx', 'C:/workspace')).toBe(
    'C:/workspace/artifacts/out.pptx',
  );
  expect(fileUrlToNativePath('https://example.com/report.pptx')).toBeNull();
  // Malformed escapes stay verbatim instead of silently resolving elsewhere.
  expect(fileUrlToNativePath('file:///D:/%zz')).toBe('D:/%zz');
});
