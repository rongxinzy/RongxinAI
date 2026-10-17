import { describe, expect, test } from 'vitest';

import {
  PreviewEdition,
  PreviewQuery,
  PreviewScenario,
  buildPreviewSearch,
  readPreviewEdition,
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

  test('buildPreviewSearch omits default values', () => {
    expect(buildPreviewSearch({})).toBe('');
    expect(buildPreviewSearch({ scenario: PreviewScenario.Loading, skipBoot: true })).toBe(
      '?previewScenario=loading&previewSkipBoot=1',
    );
  });
});
