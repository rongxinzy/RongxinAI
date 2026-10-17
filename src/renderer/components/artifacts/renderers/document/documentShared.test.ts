import { expect, test } from 'vitest';

import { dataUrlToArrayBuffer, getExtension } from './documentShared';

test('getExtension returns the lowercased extension with its dot', () => {
  expect(getExtension('Report.PDF')).toBe('.pdf');
  expect(getExtension('archive.tar.gz')).toBe('.gz');
  expect(getExtension('a.b/c.Md')).toBe('.md');
});

test('getExtension returns an empty string when the name has no extension', () => {
  expect(getExtension('README')).toBe('');
  expect(getExtension('')).toBe('');
});

test('dataUrlToArrayBuffer decodes base64 data URLs', () => {
  // 'Hi' -> base64 'SGk='
  const buffer = dataUrlToArrayBuffer('data:text/plain;base64,SGk=');
  expect(new Uint8Array(buffer)).toEqual(new Uint8Array([72, 105]));
});

test('dataUrlToArrayBuffer falls back to utf-8 encoding for non-base64 input', () => {
  const buffer = dataUrlToArrayBuffer('hi');
  expect(new TextDecoder().decode(buffer)).toBe('hi');

  // URLs without the base64 marker are encoded verbatim, prefix included.
  const dataUrlNoBase64 = dataUrlToArrayBuffer('data:text/plain,hi');
  expect(new TextDecoder().decode(dataUrlNoBase64)).toBe('data:text/plain,hi');
});
