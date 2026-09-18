import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

/**
 * 案例库内容契约：每个快捷技能（public/quick-actions.json 中的一个 action）
 * 都必须提供至少 6 个案例，并且每个案例在中英文下都有完整的
 * label / description / prompt，否则案例卡片会退化成只有 ID 的空壳。
 *
 * 封面缩略图的契约见 casePreviews.test.ts。
 */
const MIN_CASES_PER_ACTION = 6;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const publicDir = resolve(projectRoot, 'public');

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

interface LocalizedCase {
  label?: string;
  description?: string;
  prompt?: string;
}

interface I18nData {
  [actionId: string]: {
    label?: string;
    prompts?: Record<string, LocalizedCase>;
  };
}

interface I18nCatalogue {
  zh: I18nData;
  en: I18nData;
}

const catalogue = JSON.parse(
  readFileSync(resolve(publicDir, 'quick-actions.json'), 'utf8'),
) as Catalogue;

const i18n = JSON.parse(
  readFileSync(resolve(publicDir, 'quick-actions-i18n.json'), 'utf8'),
) as I18nCatalogue;

const languages = ['zh', 'en'] as const;

const allCases = catalogue.actions.flatMap(action => action.prompts ?? []);

describe('quick action case library', () => {
  test('every quick action ships at least six cases', () => {
    expect(catalogue.actions.length).toBeGreaterThan(0);

    const short = catalogue.actions
      .filter(action => (action.prompts ?? []).length < MIN_CASES_PER_ACTION)
      .map(action => `${action.id}: ${(action.prompts ?? []).length}`);

    expect(short).toEqual([]);
  });

  test('case ids are unique across the whole catalogue', () => {
    const ids = allCases.map(item => item.id);
    expect(ids.length).toBeGreaterThan(0);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

    expect(duplicates).toEqual([]);
  });

  test('every case is fully localized in both languages', () => {
    expect(allCases.length).toBeGreaterThan(0);

    const incomplete = catalogue.actions.flatMap(action =>
      (action.prompts ?? []).flatMap(item =>
        languages.flatMap(language => {
          const entry = i18n[language]?.[action.id]?.prompts?.[item.id];
          if (!entry) return [`${language}:${item.id}: missing`];

          return (['label', 'description', 'prompt'] as const)
            .filter(field => !entry[field]?.trim())
            .map(field => `${language}:${item.id}: empty ${field}`);
        }),
      ),
    );

    expect(incomplete).toEqual([]);
  });

  test('every action is labelled in both languages', () => {
    const unlabelled = languages.flatMap(language =>
      catalogue.actions
        .filter(action => !i18n[language]?.[action.id]?.label?.trim())
        .map(action => `${language}:${action.id}`),
    );

    expect(unlabelled).toEqual([]);
  });

  test('every case declares a preview', () => {
    const missing = catalogue.actions.flatMap(action =>
      (action.prompts ?? []).filter(item => !item.preview).map(item => item.id),
    );

    expect(missing).toEqual([]);
  });
});
