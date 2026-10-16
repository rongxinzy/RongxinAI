import { expect, test } from 'vitest';

import {
  extractBase64FromDataUrl,
  getFileNameFromPath,
  isImageMimeType,
  isImagePath,
} from './promptInputUtils';

test('isImagePath recognizes image extensions case-insensitively', () => {
  expect(isImagePath('photo.png')).toBe(true);
  expect(isImagePath('photo.JPG')).toBe(true);
  expect(isImagePath('avatar.webp')).toBe(true);
  expect(isImagePath('icon.avif')).toBe(true);
  expect(isImagePath('D:/docs/figure.SVG')).toBe(true);
});

test('isImagePath rejects non-image and extension-less paths', () => {
  expect(isImagePath('notes.txt')).toBe(false);
  expect(isImagePath('archive.tar.gz')).toBe(false);
  expect(isImagePath('no-extension')).toBe(false);
  expect(isImagePath('')).toBe(false);
});

test('isImageMimeType only accepts image/* mime types', () => {
  expect(isImageMimeType('image/png')).toBe(true);
  expect(isImageMimeType('image/svg+xml')).toBe(true);
  expect(isImageMimeType('text/plain')).toBe(false);
  expect(isImageMimeType('application/octet-stream')).toBe(false);
  expect(isImageMimeType('')).toBe(false);
});

test('extractBase64FromDataUrl splits mime type and payload', () => {
  expect(extractBase64FromDataUrl('data:image/png;base64,aW1hZ2U=')).toEqual({
    mimeType: 'image/png',
    base64Data: 'aW1hZ2U=',
  });
});

test('extractBase64FromDataUrl returns null for non-base64 data urls', () => {
  expect(extractBase64FromDataUrl('invalid-data-url')).toBeNull();
  expect(extractBase64FromDataUrl('data:image/png,rawpayload')).toBeNull();
  expect(extractBase64FromDataUrl('')).toBeNull();
});

test('getFileNameFromPath accepts both path separators', () => {
  expect(getFileNameFromPath('D:/work/notes.txt')).toBe('notes.txt');
  expect(getFileNameFromPath('D:\\work\\notes.txt')).toBe('notes.txt');
  expect(getFileNameFromPath('notes.txt')).toBe('notes.txt');
});

test('getFileNameFromPath falls back to the full path on trailing separators', () => {
  expect(getFileNameFromPath('D:/work/')).toBe('D:/work/');
});
