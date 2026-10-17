export const HF_MIRROR_BASE_URL = 'https://hf-mirror.com';

export function buildModelScopeFileUrl(
  modelId: string,
  filePath: string,
  revision = 'master',
): string {
  const [owner, repo] = modelId.split('/');
  if (!owner || !repo) throw new Error('ModelScope model ID must be in owner/repo format.');
  const encodedPath = encodeModelRepoFilePath(filePath);
  return `https://www.modelscope.cn/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/resolve/${encodeURIComponent(revision)}/${encodedPath}`;
}

export function buildHfMirrorFileUrl(
  modelId: string,
  filePath: string,
  revision = 'master',
): string {
  const [owner, repo] = modelId.split('/');
  if (!owner || !repo) throw new Error('ModelScope model ID must be in owner/repo format.');
  const encodedPath = encodeModelRepoFilePath(filePath);
  return `${HF_MIRROR_BASE_URL}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/resolve/${encodeURIComponent(revision)}/${encodedPath}`;
}

export function encodeModelRepoFilePath(filePath: string): string {
  return filePath
    .split(/[\\/]+/)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

export function convertModelScopeDownloadUrlToHfMirror(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, '');
    if (hostname !== 'modelscope.cn') return undefined;
    const match = parsed.pathname.match(/^\/models\/([^/]+)\/([^/]+)\/resolve\/([^/]+)\/(.*)$/);
    if (!match) return undefined;
    const [, owner, repo, revision, filePath] = match;
    return `${HF_MIRROR_BASE_URL}/${owner}/${repo}/resolve/${revision}/${filePath}`;
  } catch {
    return undefined;
  }
}

export function resolveGgufModelDownloadUrls(input: {
  modelId: string;
  filePath: string;
  revision?: string;
  downloadUrl?: string;
}): string[] {
  const revision = input.revision?.trim() || 'master';
  const explicit = input.downloadUrl?.trim();
  if (explicit) {
    const mirror = convertModelScopeDownloadUrlToHfMirror(explicit);
    if (mirror && mirror !== explicit) {
      return [explicit, mirror];
    }
    return [explicit];
  }
  return [
    buildModelScopeFileUrl(input.modelId, input.filePath, revision),
    buildHfMirrorFileUrl(input.modelId, input.filePath, revision),
  ];
}
