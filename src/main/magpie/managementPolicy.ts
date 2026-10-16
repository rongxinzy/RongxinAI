import { HOST_PROVIDER_PREFIX } from './hostProviders';
/** Host-generated enterprise/GPU entries are visible but cannot be edited by the upstream Web UI. */
export function mayEditProviderFromManagement(body: string): boolean {
  if (Buffer.byteLength(body) > 64 * 1024) return false;
  let remaining = 5000;
  const allowed = (value: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > 10) return false;
    if (typeof value === 'string') return !value.startsWith(HOST_PROVIDER_PREFIX);
    if (Array.isArray(value)) return value.every(entry => allowed(entry, depth + 1));
    if (value && typeof value === 'object')
      return Object.entries(value).every(
        ([key, entry]) => allowed(key, depth + 1) && allowed(entry, depth + 1),
      );
    return true;
  };
  try {
    return allowed(JSON.parse(body), 0);
  } catch {
    return false;
  }
}
