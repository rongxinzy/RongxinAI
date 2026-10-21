/** URL query keys for browser preview (`bun run web:preview`). */
export const PreviewQuery = {
  Scenario: 'previewScenario',
  Edition: 'previewEdition',
  SkipBoot: 'previewSkipBoot',
  MagpieUsage: 'previewMagpieUsage',
  Locale: 'previewLocale',
  Platform: 'previewPlatform',
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
  return PreviewScenario.Default;
}

export function readPreviewEdition(searchParams = readPreviewSearchParams()): PreviewEdition {
  const raw = searchParams.get(PreviewQuery.Edition)?.trim().toLowerCase();
  if (raw === PreviewEdition.Xiaoruan) return PreviewEdition.Xiaoruan;
  return PreviewEdition.Zhiyuan;
}

export const PreviewPlatform = {
  Darwin: 'darwin',
  Win32: 'win32',
  Linux: 'linux',
} as const;

export type PreviewPlatform = (typeof PreviewPlatform)[keyof typeof PreviewPlatform];

/** Optional window-chrome override for design walkthroughs and screenshots. */
export function readPreviewPlatform(
  searchParams = readPreviewSearchParams(),
): PreviewPlatform | null {
  const raw = searchParams.get(PreviewQuery.Platform)?.trim().toLowerCase();
  if (raw === PreviewPlatform.Darwin) return PreviewPlatform.Darwin;
  if (raw === PreviewPlatform.Win32) return PreviewPlatform.Win32;
  if (raw === PreviewPlatform.Linux) return PreviewPlatform.Linux;
  return null;
}

/** Optional system-locale override; accepts the same zh-CN / en-US values as Electron. */
export function readPreviewLocale(searchParams = readPreviewSearchParams()): string | null {
  const raw = searchParams.get(PreviewQuery.Locale)?.trim();
  if (raw === 'zh-CN' || raw === 'en-US') return raw;
  return null;
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
