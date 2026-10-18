import { describe, expect, test } from 'vitest';

import {
  getArtifactTypeFromExtension,
  getFileExtension,
  getFileName,
  normalizeFilePathForDedup,
} from './artifactPaths';

describe('normalizeFilePathForDedup', () => {
  test('strips leading / before Windows drive letter', () => {
    expect(normalizeFilePathForDedup('/D:/path/file.html')).toBe('d:/path/file.html');
  });

  test('normalizes backslashes to forward slashes', () => {
    expect(normalizeFilePathForDedup('D:\\path\\file.html')).toBe('d:/path/file.html');
  });

  test('lowercases for case-insensitive comparison', () => {
    expect(normalizeFilePathForDedup('D:/Path/File.HTML')).toBe('d:/path/file.html');
  });

  test('handles Unix absolute paths unchanged (except lowercase)', () => {
    expect(normalizeFilePathForDedup('/home/user/file.html')).toBe('/home/user/file.html');
  });

  test('dedup matches: file:// derived path vs tool path', () => {
    const fromFileUrl = '/D:/new_ws_test_2/hello-slide.html';
    const fromTool = 'D:\\new_ws_test_2\\hello-slide.html';
    expect(normalizeFilePathForDedup(fromFileUrl)).toBe(normalizeFilePathForDedup(fromTool));
  });

  test('decodes percent-encoded paths before deduplication', () => {
    expect(normalizeFilePathForDedup('file:///D:/output/report%20final.csv')).toBe(
      'd:/output/report final.csv',
    );
  });
});

describe('getFileExtension', () => {
  test('returns the lowercased extension with its leading dot', () => {
    expect(getFileExtension('/a/b/Report.HTML')).toBe('.html');
  });

  test('returns an empty string when there is no extension', () => {
    expect(getFileExtension('/a/b/README')).toBe('');
  });
});

describe('getFileName', () => {
  test('returns the last segment for both separator styles', () => {
    expect(getFileName('D:/workspace/report.pptx')).toBe('report.pptx');
    expect(getFileName('D:\\workspace\\report.pptx')).toBe('report.pptx');
  });

  test('returns the whole string when there is no separator', () => {
    expect(getFileName('report.pptx')).toBe('report.pptx');
  });
});

describe('getArtifactTypeFromExtension', () => {
  test('maps known extensions to artifact types', () => {
    expect(getArtifactTypeFromExtension('.html')).toBe('html');
    expect(getArtifactTypeFromExtension('.pptx')).toBe('document');
    expect(getArtifactTypeFromExtension('.stl')).toBe('model');
  });

  test('returns null for unknown extensions', () => {
    expect(getArtifactTypeFromExtension('.custombinary')).toBeNull();
  });
});
