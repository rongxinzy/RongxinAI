import { expect, test } from 'vitest';

import {
  ArtifactPreviewMode,
  getArtifactPreviewMode,
  getArtifactTypeByExtension,
  isBinaryArtifactFile,
} from './artifactPreview';

test('recognizes legacy and template Office files as binary documents', () => {
  const fileNames = [
    'word-legacy.doc',
    'word-template.dotx',
    'excel-template.xltx',
    'powerpoint-legacy.ppt',
    'powerpoint-template.potx',
  ];

  for (const fileName of fileNames) {
    expect(getArtifactTypeByExtension(fileName)).toBe('document');
    expect(isBinaryArtifactFile(fileName)).toBe(true);
  }
});

test('recognizes BMP files as binary images', () => {
  expect(getArtifactTypeByExtension('example.bmp')).toBe('image');
  expect(isBinaryArtifactFile('example.bmp')).toBe(true);
});

test('recognizes ICO files as binary images', () => {
  expect(getArtifactTypeByExtension('example.ico')).toBe('image');
  expect(isBinaryArtifactFile('example.ico')).toBe(true);
});

test('uses the unsupported preview mode for unknown declared files', () => {
  expect(getArtifactPreviewMode('unsupported')).toBe(ArtifactPreviewMode.Unsupported);
});
