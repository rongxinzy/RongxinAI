const MODELSCOPE_IMAGE_HOSTS = new Set([
  'resources.modelscope.cn',
  'modelscope.oss-cn-beijing.aliyuncs.com',
]);

export function getSkillInitial(name: string): string {
  const first = name.trim().split(/[\s_-]+/)[0] || '?';
  return Array.from(first)[0]?.toUpperCase() || '?';
}

/** Request a larger ModelScope OSS variant so small marketplace logos are not stretched. */
export function resolveSkillIconUrl(iconUrl?: string): string | undefined {
  const value = iconUrl?.trim();
  if (!value || value.startsWith('data:')) return value || undefined;
  try {
    const url = new URL(value);
    if (!MODELSCOPE_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return value;
    if (!url.searchParams.has('x-oss-process')) {
      url.searchParams.set('x-oss-process', 'image/resize,w_256,h_256,limit_0');
    }
    return url.toString();
  } catch {
    return value;
  }
}
