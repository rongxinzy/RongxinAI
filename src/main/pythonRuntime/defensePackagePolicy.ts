import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PythonPackageIndexUrl } from '../libs/pythonPackageIndexes';
import { isOwnedExternalUrl } from '../shellIpc/ownedExternalUrls';

export const DEFENSE_INDEX_ENV = 'ZHIYUAN_DEFENSE_PYPI_INDEX_URL';
export const DEFENSE_WHEELHOUSE_DIRECTORY = 'defense-python';

const publicIndexHosts = Object.values(PythonPackageIndexUrl).map(index => new URL(index).hostname);

export function readDefensePythonIndex(value = process.env[DEFENSE_INDEX_ENV]): string | undefined {
  if (!value?.trim()) return undefined;
  const error = new Error(
    `${DEFENSE_INDEX_ENV} must be an internal HTTPS package index URL without credentials, query or fragment.`,
  );
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw error;
  }
  const hostname = url.hostname.replace(/\.$/, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isOwnedExternalUrl(url.href) ||
    publicIndexHosts.some(host => hostname === host || hostname.endsWith(`.${host}`))
  )
    throw error;
  return url.href;
}

export function applyDefensePythonPackageEnvironment(
  env: NodeJS.ProcessEnv,
  wheelhouseRoot: string,
): void {
  // Replace inherited index and package-source configuration, including user files.
  for (const key of Object.keys(env)) {
    if (
      /^(?:PIP|UV)_(?:.*INDEX.*|.*FIND_LINKS|OFFLINE|CONFIG_FILE|NO_CONFIG|TRUSTED_HOST|INSECURE_HOST|REQUIREMENT|CONSTRAINT|BUILD_CONSTRAINT)$/i.test(
        key,
      )
    ) {
      delete env[key];
    }
  }
  env.PIP_CONFIG_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  env.UV_NO_CONFIG = '1';
  env.UV_PYTHON_DOWNLOADS = 'never';
  const wheelUrl = pathToFileURL(join(wheelhouseRoot, 'wheels')).href;
  env.PIP_FIND_LINKS = wheelUrl;
  env.UV_FIND_LINKS = wheelUrl;
  let index: string | undefined;
  try {
    index = readDefensePythonIndex();
  } catch {
    // Skill startup remains available with the local wheelhouse if configuration is invalid.
  }
  if (index) {
    env.PIP_INDEX_URL = index;
    env.UV_DEFAULT_INDEX = index;
  } else {
    env.PIP_NO_INDEX = '1';
    env.UV_NO_INDEX = '1';
    env.UV_OFFLINE = '1';
  }
}
