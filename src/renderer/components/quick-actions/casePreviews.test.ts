import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

/**
 * 案例库缩略图契约：quick-actions.json 中每个声明了 preview 的案例都必须有一张
 * 800x500 的 WebP 缩略图，该比例与卡片预览区（aspect-[8/5]）一致，
 * 否则 object-cover 会裁掉缩略图底部的内容。
 *
 * 缩略图由 npm run generate:case-previews 生成，源文件在
 * scripts/case-previews/ 与 SKILLs/frontend-design/templates/。
 */
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const publicDir = resolve(projectRoot, 'public');
const EXPECTED_WIDTH = 800;
const EXPECTED_HEIGHT = 500;

interface CatalogueCase {
  id: string;
  preview?: string;
}

interface CatalogueAction {
  id: string;
  prompts?: CatalogueCase[];
}

interface Catalogue {
  actions: CatalogueAction[];
}

function readCatalogue(): Catalogue {
  return JSON.parse(readFileSync(resolve(publicDir, 'quick-actions.json'), 'utf8')) as Catalogue;
}

function readWebpSize(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath);

  expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
  expect(buffer.subarray(12, 16).toString('ascii')).toBe('VP8X');

  const readUInt24LE = (offset: number) =>
    buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);

  return { width: readUInt24LE(24) + 1, height: readUInt24LE(27) + 1 };
}

const catalogue = readCatalogue();
const cases = catalogue.actions.flatMap(action =>
  (action.prompts ?? []).map(item => ({ ...item, actionId: action.id })),
);

describe('case previews', () => {
  test('every case declares a preview', () => {
    expect(cases.length).toBeGreaterThan(0);

    const withoutPreview = cases.filter(item => !item.preview).map(item => item.id);
    expect(withoutPreview).toEqual([]);
  });

  test('every declared preview resolves to a generated file', () => {
    const previews = cases
      .map(item => item.preview)
      .filter((preview): preview is string => Boolean(preview));
    const outsidePreviewDir = previews.filter(preview => !preview.startsWith('./case-previews/'));
    const missingFiles = previews
      .map(preview => resolve(publicDir, preview.replace(/^\.\//, '')))
      .filter(filePath => !existsSync(filePath));

    expect(outsidePreviewDir).toEqual([]);
    expect(missingFiles).toEqual([]);
  });

  test('every preview is a 800x500 WebP matching the card slot ratio', () => {
    const mismatched = cases.flatMap(item => {
      if (!item.preview) return [];

      const filePath = resolve(publicDir, item.preview.replace(/^\.\//, ''));
      const size = readWebpSize(filePath);

      return size.width === EXPECTED_WIDTH && size.height === EXPECTED_HEIGHT
        ? []
        : [`${item.id}: ${size.width}x${size.height}`];
    });

    expect(mismatched).toEqual([]);
  });
});
