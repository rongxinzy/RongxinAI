import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

  /**
   * 文档类实例必须是真实的多页文档：scripts/case-previews 下的每个实例都要有 ≥8 页，
   * 且页脚声明的总页数与实际页数一致——「只有第 1 页却写着第 1 / 8 页」正是本次改造要消灭的形态。
   * SKILLs/frontend-design/templates 下的实时网页模板不受此约束：它们是可直接运行的单页应用，
   * 缩略图取首屏。
   */
  test('every document example is a real multi-page document', () => {
    const MIN_PAGES = 8;
    const coverDir = resolve(projectRoot, 'scripts/case-previews');
    const failures: string[] = [];

    for (const file of readdirSync(coverDir).filter(name => name.endsWith('.html'))) {
      const html = readFileSync(join(coverDir, file), 'utf8');
      const pages = html.match(/data-page="/g)?.length ?? 0;
      const claimed = Math.max(
        0,
        ...[...html.matchAll(/第\s*\d+\s*\/\s*(\d+)\s*页/g)].map(match => Number(match[1])),
      );

      if (pages < MIN_PAGES) failures.push(`${file}: ${pages} page(s)`);
      else if (claimed !== pages)
        failures.push(`${file}: footer says ${claimed}, file has ${pages}`);
    }

    expect(failures).toEqual([]);
  });
});
