import { describe, expect, test } from 'vitest';

import {
  buildLogExportFileName,
  ensurePngFileName,
  ensureZipFileName,
  getDefaultExportImageName,
  inferAttachmentExtension,
  normalizeCaptureRect,
  sanitizeAttachmentFileName,
  sanitizeExportFileName,
} from './fileExportHelpers';

describe('sanitizeExportFileName', () => {
  test('strips invalid filename characters and collapses whitespace', () => {
    expect(sanitizeExportFileName('a<b>:c/"d\\|e?*f')).toBe('a b c d e f');
    expect(sanitizeExportFileName('  lots   of   space  ')).toBe('lots of space');
  });

  test('falls back to default when nothing remains', () => {
    expect(sanitizeExportFileName('???')).toBe('cowork-session');
    expect(sanitizeExportFileName('')).toBe('cowork-session');
  });
});

describe('sanitizeAttachmentFileName', () => {
  test('defaults for empty or non-string input', () => {
    expect(sanitizeAttachmentFileName(undefined)).toBe('attachment');
    expect(sanitizeAttachmentFileName('   ')).toBe('attachment');
    expect(sanitizeAttachmentFileName(42 as unknown as string)).toBe('attachment');
  });

  test('reduces paths to the basename', () => {
    expect(sanitizeAttachmentFileName('/tmp/dir/report:v2.txt')).toBe('report v2.txt');
    expect(sanitizeAttachmentFileName('/home/me/file?.md')).toBe('file .md');
  });
});

describe('inferAttachmentExtension', () => {
  test('prefers the extension already present in the name', () => {
    expect(inferAttachmentExtension('photo.PNG')).toBe('.png');
    expect(inferAttachmentExtension('archive.tar.gz')).toBe('.gz');
  });

  test('maps known MIME types when the name has no extension', () => {
    expect(inferAttachmentExtension('photo', 'image/png')).toBe('.png');
    expect(inferAttachmentExtension('doc', 'application/pdf; charset=binary')).toBe('.pdf');
  });

  test('returns empty string for unknown MIME without extension', () => {
    expect(inferAttachmentExtension('blob', 'application/x-unknown')).toBe('');
    expect(inferAttachmentExtension('blob')).toBe('');
  });
});

describe('ensurePngFileName / ensureZipFileName', () => {
  test('appends the extension only when missing', () => {
    expect(ensurePngFileName('shot')).toBe('shot.png');
    expect(ensurePngFileName('shot.PNG')).toBe('shot.PNG');
    expect(ensurePngFileName('shot.png')).toBe('shot.png');
    expect(ensureZipFileName('logs')).toBe('logs.zip');
    expect(ensureZipFileName('logs.zip')).toBe('logs.zip');
  });
});

describe('normalizeCaptureRect', () => {
  test('returns null for missing or zero-area rects', () => {
    expect(normalizeCaptureRect(undefined)).toBeNull();
    expect(normalizeCaptureRect(null)).toBeNull();
    expect(normalizeCaptureRect({ x: 0, y: 0, width: 0, height: 10 })).toBeNull();
    expect(normalizeCaptureRect({ x: 0, y: 0, width: 10, height: -1 })).toBeNull();
  });

  test('rounds and clamps values to non-negative integers', () => {
    expect(normalizeCaptureRect({ x: -3.2, y: 4.7, width: 10.4, height: 5.5 })).toEqual({
      x: 0,
      y: 5,
      width: 10,
      height: 6,
    });
  });

  test('fills missing coordinates with zero', () => {
    expect(normalizeCaptureRect({ width: 10, height: 10 })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
  });
});

describe('getDefaultExportImageName', () => {
  test('sanitizes and forces the png extension on a provided name', () => {
    expect(getDefaultExportImageName('my shot:1')).toBe('my shot 1.png');
    expect(getDefaultExportImageName('ready.png')).toBe('ready.png');
  });

  test('generates a timestamped name when none provided', () => {
    expect(getDefaultExportImageName(undefined)).toMatch(/^cowork-session-\d+\.png$/);
    expect(getDefaultExportImageName('   ')).toMatch(/^cowork-session-\d+\.png$/);
  });
});

describe('buildLogExportFileName', () => {
  test('formats a dated zip file name', () => {
    expect(buildLogExportFileName()).toMatch(/^zhiyuan-logs-\d{8}-\d{6}\.zip$/);
  });
});
