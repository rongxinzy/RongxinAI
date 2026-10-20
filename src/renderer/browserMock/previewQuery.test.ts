import { describe, expect, test } from 'vitest';

import {
  PreviewEdition,
  PreviewQuery,
  PreviewScenario,
  buildPreviewSearch,
  PreviewLocale,
  readPreviewEdition,
  readPreviewLocale,
  readPreviewScenario,
  shouldSkipPreviewBoot,
} from './previewQuery';

describe('previewQuery', () => {
  test('parses scenario, edition, and skip-boot flags', () => {
    const params = new URLSearchParams(
      `${PreviewQuery.Scenario}=${PreviewScenario.Empty}&${PreviewQuery.Edition}=${PreviewEdition.Xiaoruan}&${PreviewQuery.SkipBoot}=1`,
    );
    expect(readPreviewScenario(params)).toBe(PreviewScenario.Empty);
    expect(readPreviewEdition(params)).toBe(PreviewEdition.Xiaoruan);
    expect(shouldSkipPreviewBoot(params)).toBe(true);
  });

  test('parses preview locale', () => {
    expect(readPreviewLocale(new URLSearchParams(`${PreviewQuery.Locale}=zh`))).toBe(
      PreviewLocale.Chinese,
    );
    expect(readPreviewLocale(new URLSearchParams(`${PreviewQuery.Locale}=en`))).toBe(
      PreviewLocale.English,
    );
    expect(readPreviewLocale(new URLSearchParams())).toBeNull();
  });

  test('buildPreviewSearch omits default values', () => {
    expect(buildPreviewSearch({})).toBe('');
    expect(buildPreviewSearch({ scenario: PreviewScenario.Loading, skipBoot: true })).toBe(
      '?previewScenario=loading&previewSkipBoot=1',
    );
  });
});
