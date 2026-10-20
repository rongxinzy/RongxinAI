/** URL query keys for browser preview (`bun run web:preview`). */
export const PreviewQuery = {
  Scenario: 'previewScenario',
  Edition: 'previewEdition',
  SkipBoot: 'previewSkipBoot',
  MagpieUsage: 'previewMagpieUsage',
} as const;

export const PreviewMagpieUsage = {
  Populated: 'populated',
  Empty: 'empty',
  Error: 'error',
} as const;
export type PreviewMagpieUsage = (typeof PreviewMagpieUsage)[keyof typeof PreviewMagpieUsage];

export const PreviewScenario = {
  Default: 'default',
  Empty: 'empty',
  Error: 'error',
  Loading: 'loading',
  Coding: 'coding',
} as const;

export type PreviewScenario = (typeof PreviewScenario)[keyof typeof PreviewScenario];

export const PreviewEdition = {
  Zhiyuan: 'zhiyuan',
  Xiaoruan: 'xiaoruan',
} as const;

export type PreviewEdition = (typeof PreviewEdition)[keyof typeof PreviewEdition];

function readPreviewSearchParams(
  search = typeof window !== 'undefined' ? window.location.search : '',
): URLSearchParams {
  return new URLSearchParams(search);
}

export function readPreviewScenario(searchParams = readPreviewSearchParams()): PreviewScenario {
  const raw = searchParams.get(PreviewQuery.Scenario)?.trim().toLowerCase();
  if (raw === PreviewScenario.Empty) return PreviewScenario.Empty;
  if (raw === PreviewScenario.Error) return PreviewScenario.Error;
  if (raw === PreviewScenario.Loading) return PreviewScenario.Loading;
  if (raw === PreviewScenario.Coding) return PreviewScenario.Coding;
  return PreviewScenario.Default;
}

export function readPreviewEdition(searchParams = readPreviewSearchParams()): PreviewEdition {
  const raw = searchParams.get(PreviewQuery.Edition)?.trim().toLowerCase();
  if (raw === PreviewEdition.Xiaoruan) return PreviewEdition.Xiaoruan;
  return PreviewEdition.Zhiyuan;
}

export function readPreviewMagpieUsage(
  searchParams = readPreviewSearchParams(),
): PreviewMagpieUsage {
  const raw = searchParams.get(PreviewQuery.MagpieUsage)?.trim().toLowerCase();
  if (raw === PreviewMagpieUsage.Empty) return PreviewMagpieUsage.Empty;
  if (raw === PreviewMagpieUsage.Error) return PreviewMagpieUsage.Error;
  return PreviewMagpieUsage.Populated;
}

export function shouldSkipPreviewBoot(searchParams = readPreviewSearchParams()): boolean {
  const raw = searchParams.get(PreviewQuery.SkipBoot)?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function buildPreviewSearch(options: {
  scenario?: PreviewScenario;
  edition?: PreviewEdition;
  skipBoot?: boolean;
  extra?: Record<string, string>;
}): string {
  const params = new URLSearchParams();
  if (options.scenario && options.scenario !== PreviewScenario.Default) {
    params.set(PreviewQuery.Scenario, options.scenario);
  }
  if (options.edition && options.edition !== PreviewEdition.Zhiyuan) {
    params.set(PreviewQuery.Edition, options.edition);
  }
  if (options.skipBoot) {
    params.set(PreviewQuery.SkipBoot, '1');
  }
  if (options.extra) {
    for (const [key, value] of Object.entries(options.extra)) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
