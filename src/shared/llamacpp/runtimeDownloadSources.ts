export const LLAMACPP_RUNTIME_GITHUB_REPO = 'ggml-org/llama.cpp';
export const DEFAULT_LLAMACPP_RUNTIME_RELEASES_URL = 'https://rongxinai.krli.org/llamacpp';
export const GITHUB_LLAMACPP_RELEASE_BASE_URL =
  'https://github.com/ggml-org/llama.cpp/releases/download';

/** Opt-in only: upstream GitHub releases (blocked for many CN users). */
export const LLAMACPP_RUNTIME_ALLOW_GITHUB_FALLBACK_ENV = 'LLAMACPP_RUNTIME_ALLOW_GITHUB_FALLBACK';

export type LlamaCppRuntimeDownloadSourceOptions = {
  targetId: string;
  assetName: string;
  releaseTag: string;
  env?: NodeJS.ProcessEnv;
};

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function resolveLlamaCppRuntimeAssetDownloadUrls(
  options: LlamaCppRuntimeDownloadSourceOptions,
): string[] {
  const env = options.env ?? process.env;
  const { targetId, assetName, releaseTag } = options;

  const explicitUrl = env.LLAMACPP_RUNTIME_URL?.trim();
  if (explicitUrl) {
    return [explicitUrl.replace(/\{target\}/g, targetId).replace(/\{asset\}/g, assetName)];
  }

  const baseUrl = env.LLAMACPP_RUNTIME_BASE_URL?.trim();
  if (baseUrl) {
    return [`${baseUrl.replace(/\/$/, '')}/${assetName}`];
  }

  const mirrorUrl = `${DEFAULT_LLAMACPP_RUNTIME_RELEASES_URL.replace(/\/$/, '')}/${releaseTag}/${assetName}`;
  const githubRepo = env.LLAMACPP_RUNTIME_GITHUB_REPO?.trim() || LLAMACPP_RUNTIME_GITHUB_REPO;
  const githubUrl = `https://github.com/${githubRepo}/releases/download/${releaseTag}/${assetName}`;

  const ciPreferred = isTruthyEnv(env.CI) || isTruthyEnv(env.GITHUB_ACTIONS);
  if (ciPreferred) {
    if (isTruthyEnv(env.LLAMACPP_RUNTIME_ALLOW_MIRROR_FALLBACK)) {
      return [githubUrl, mirrorUrl];
    }
    return [githubUrl];
  }

  if (!isTruthyEnv(env[LLAMACPP_RUNTIME_ALLOW_GITHUB_FALLBACK_ENV])) {
    return [mirrorUrl];
  }

  return [mirrorUrl, githubUrl];
}
