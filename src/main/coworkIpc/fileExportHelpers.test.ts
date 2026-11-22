import { describe, expect, test } from 'vitest';

import {
  buildLogExportFileName,
  ensureZipFileName,
  inferAttachmentExtension,
  sanitizeAttachmentFileName,
} from './fileExportHelpers';

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

describe('ensureZipFileName', () => {
  test('appends the extension only when missing', () => {
    expect(ensureZipFileName('logs')).toBe('logs.zip');
    expect(ensureZipFileName('logs.zip')).toBe('logs.zip');
  });
});

describe('buildLogExportFileName', () => {
  test('formats a dated zip file name', () => {
    expect(buildLogExportFileName()).toMatch(/^zhiyuan-logs-\d{8}-\d{6}\.zip$/);
  });
});
