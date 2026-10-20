import { isSystemProxyEnabled, resolveSystemProxyUrlForTargets } from '../systemProxy';
import { applyApplicationRuntimeEnv, type EnhancedEnvOptions } from './applyApplicationRuntimeEnv';
import { getElectronNodeRuntimePath } from './electronNodeRuntime';
import { getSkillsRoot } from './skillsRoot';

/**
 * Get enhanced environment variables (including proxy configuration)
 * Async function to fetch system proxy and inject into environment variables
 */
export async function getEnhancedEnv(
  options: EnhancedEnvOptions = {},
): Promise<Record<string, string | undefined>> {
  const env = { ...process.env };

  await applyApplicationRuntimeEnv(env, options);

  // Inject SKILLs directory path for skill scripts.
  // On Windows, normalise backslashes to forward slashes so the value is usable
  // in both Node.js (which accepts forward slashes) and bash (which treats
  // backslashes as escape characters).
  const skillsRoot = getSkillsRoot().replace(/\\/g, '/');
  env.SKILLS_ROOT = skillsRoot;
  env.ZHIYUAN_SKILLS_ROOT = skillsRoot; // Alternative name for clarity
  if (process.platform === 'win32' || env.ZHIYUAN_NODE_SHIM_ACTIVE === '1') {
    env.ZHIYUAN_ELECTRON_PATH = getElectronNodeRuntimePath().replace(/\\/g, '/');
  } else {
    delete env.ZHIYUAN_ELECTRON_PATH;
  }

  // Skip system proxy resolution if proxy env vars already exist
  if (env.http_proxy || env.HTTP_PROXY || env.https_proxy || env.HTTPS_PROXY) {
    return env;
  }

  // User can disable system proxy from settings.
  if (!isSystemProxyEnabled()) {
    return env;
  }

  // Resolve proxy from system settings
  const { proxyUrl, targetUrl } = await resolveSystemProxyUrlForTargets();
  if (proxyUrl) {
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    console.log(`[CoworkUtil] Injected system proxy for subprocess via ${targetUrl}:`, proxyUrl);
  }

  return env;
}
